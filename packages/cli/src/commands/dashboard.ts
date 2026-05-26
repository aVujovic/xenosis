import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { sync as globSync } from 'glob';
import { buildGraph, type ServiceGraph } from './graph';
import { dashboardHtml } from './dashboard.html';

/**
 * The `xenosis dev` dashboard — a tiny zero-dependency HTTP + Server-Sent-Events
 * server that renders the workspace as a live peer graph in the browser
 * (localhost:9000 by default).
 *
 * It deliberately reuses only what `xenosis dev` already has on hand:
 *  - the static peer mesh from each service's xenosis.config.json (buildGraph),
 *  - the /healthcheck endpoint every service ships with (green / grey nodes),
 *  - the stdout/stderr already piped per service (streamed per-node to the UI).
 *
 * Transport is SSE rather than WebSockets so the CLI stays dependency-light:
 * the browser only ever reads, and SSE is a plain `text/event-stream` response
 * over the same Node http server that serves the page.
 */

/** One service as the dashboard needs it: graph identity + where to poll health. */
export interface DashboardService {
  /** Peer identity (peerName ?? name ?? dir) — matches graph node + log label key. */
  name: string;
  /** The pnpm package name — this is the label `xenosis dev` prefixes logs with. */
  pkgName: string;
  /** Local port the service listens on (config.port), if known. */
  port: number | undefined;
}

type Status = 'starting' | 'up' | 'down';

interface ServiceState {
  status: Status;
  /** Last N log lines, newest last. */
  logs: { line: string; stream: 'out' | 'err'; ts: number }[];
}

const LOG_RING = 200; // lines retained per service for late-joining browser tabs
const HEALTH_TIMEOUT_MS = 1500;
const TELEMETRY_WINDOW_MS = 60_000; // sliding window over which the heat-map aggregates
const TELEMETRY_TICK_MS = 1_000; // edge-recompute cadence — fast enough to feel live, slow enough to be cheap
const TELEMETRY_BODY_LIMIT = 64 * 1024; // hard cap per telemetry POST so a runaway client can't OOM the dashboard
const TRACE_WINDOW_MS = 5 * 60_000; // trace store window — longer than the heat-map so `explain_trace` can reach back a few minutes
const TRACE_MAX_IDS = 200; // hard cap on distinct trace ids retained in memory
const SECRET_KEY = /(token|secret|password|api[_-]?key|jwt[_-]?secret|authorization)/i;

/**
 * Defense-in-depth redaction at the storage boundary. The core's
 * createPeerClient already redacts before emitting, but the dashboard sees
 * bodies it didn't generate (sender could be anything). Re-redact here so a
 * stray field never reaches an LLM via /api/trace.
 */
function redactStored(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'string') {
    // Mask URL credentials.
    return v.replace(/(\w+:\/\/[^:/\s]+:)([^@\s]+)(@)/g, '$1<redacted>$3');
  }
  if (Array.isArray(v)) return v.map(redactStored);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEY.test(k) && val && typeof val === 'string' && val.length > 0) {
        out[k] = '<redacted>';
      } else {
        out[k] = redactStored(val);
      }
    }
    return out;
  }
  return v;
}

interface SseClient {
  res: ServerResponse;
}

export interface Dashboard {
  /** Record a log line for a service and fan it out to connected browsers. */
  pushLog(pkgName: string, line: string, stream: 'out' | 'err'): void;
  /** Stop health polling and close the HTTP server + all SSE connections. */
  close(): Promise<void>;
  /** The resolved URL the dashboard is listening on. */
  url: string;
}

/** Read every service's xenosis.config.json into a graph + a name→port map. */
async function readServices(
  root: string,
  servicesDir: string,
): Promise<{ graph: ServiceGraph; services: DashboardService[] }> {
  const configPaths = globSync(`${servicesDir}/*/xenosis.config.json`, {
    cwd: root,
    absolute: true,
  }).sort();

  const nodes = [];
  const services: DashboardService[] = [];

  for (const p of configPaths) {
    let cfg: {
      name?: string;
      peerName?: string;
      port?: number;
      peers?: Record<string, unknown>;
      boundaries?: { allowedCallers?: string[] };
    };
    try {
      cfg = JSON.parse(await readFile(p, 'utf-8'));
    } catch {
      continue;
    }
    const name = cfg.peerName ?? cfg.name ?? 'unknown';
    nodes.push({
      name,
      calls: cfg.peers ? Object.keys(cfg.peers) : [],
      allowedCallers: cfg.boundaries?.allowedCallers,
    });
    services.push({
      name,
      // `xenosis dev` labels logs with the package name; the graph keys on
      // peerName. We need both to bridge a log line back to its graph node.
      pkgName: cfg.name ?? name,
      port: typeof cfg.port === 'number' ? cfg.port : undefined,
    });
  }

  return { graph: buildGraph(nodes), services };
}

/**
 * Start the dashboard server. Returns a handle `xenosis dev` uses to feed it log
 * lines and to shut it down on SIGINT.
 */
export async function startDashboard(opts: {
  root: string;
  servicesDir: string;
  port: number;
}): Promise<Dashboard> {
  const { graph, services } = await readServices(opts.root, opts.servicesDir);

  // pkgName → graph node name, for routing piped log lines to the right node.
  const pkgToName = new Map(services.map((s) => [s.pkgName, s.name]));

  const state = new Map<string, ServiceState>();
  for (const s of services) state.set(s.name, { status: 'starting', logs: [] });

  const clients = new Set<SseClient>();

  // ── Peer-call telemetry (heat-map fuel) ──────────────────────────────────
  // Services POST PeerCallEvent objects to /api/telemetry (env-piped). We keep
  // a raw ring of the last TELEMETRY_WINDOW_MS, then derive aggregates every
  // TELEMETRY_TICK_MS and broadcast over SSE as `event: edges`.
  interface RawCall {
    from: string; to: string; durationMs: number;
    ok: boolean; status: number | null;
    errorName: string | undefined; ts: number;
  }
  const telemetry: RawCall[] = [];

  // Trace store: full PeerCallEvents indexed by traceId, kept longer than the
  // heat-map window so `explain_trace` can reach back a few minutes. LRU-style
  // eviction via a Map + insertion-order iteration when we exceed TRACE_MAX_IDS.
  interface TraceCall {
    from: string; to: string;
    method: string; httpMethod: string; path: string;
    status: number | null; durationMs: number;
    ok: boolean; errorName: string | undefined;
    requestBody: unknown; responseBody: unknown;
    spanId: string | undefined; parentSpanId: string | undefined;
    ts: number;
  }
  const traceStore = new Map<string, TraceCall[]>();

  interface EdgeAgg {
    from: string; to: string;
    count: number;
    errorCount: number;
    p95: number; // ms
    breakerOpen: boolean;
    retryBurst: boolean; // ≥2 errors in last 5s for this edge
  }
  let lastEdgesJson = '[]';

  // Debounced trace summary broadcast: a burst of 50 calls on one trace id
  // becomes at most one SSE event every TRACE_BROADCAST_DEBOUNCE_MS, so
  // chatty workloads don't flood the stream.
  const TRACE_BROADCAST_DEBOUNCE_MS = 250;
  const pendingTraceBroadcasts = new Map<string, NodeJS.Timeout>();

  function buildTraceSummary(tid: string): {
    traceId: string; startedAt: number; durationMs: number;
    callCount: number; failureCount: number;
    entry: { from: string; to: string; method: string } | null;
    services: string[];
  } | null {
    const calls = traceStore.get(tid);
    if (!calls || calls.length === 0) return null;
    const startedAt = calls[0]!.ts;
    const last = calls[calls.length - 1]!;
    const endedAt = last.ts + last.durationMs;
    const failureCount = calls.filter((c) => !c.ok).length;
    const services = Array.from(new Set(calls.flatMap((c) => [c.from, c.to])));
    const root = calls[0]!;
    return {
      traceId: tid,
      startedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      callCount: calls.length,
      failureCount,
      entry: { from: root.from, to: root.to, method: root.method },
      services,
    };
  }

  function scheduleTraceBroadcast(tid: string): void {
    if (pendingTraceBroadcasts.has(tid)) return;
    const handle = setTimeout(() => {
      pendingTraceBroadcasts.delete(tid);
      if (clients.size === 0) return; // no browsers — drop on the floor
      const summary = buildTraceSummary(tid);
      if (summary) broadcast('trace', summary);
    }, TRACE_BROADCAST_DEBOUNCE_MS);
    pendingTraceBroadcasts.set(tid, handle);
  }

  function recomputeEdges(): EdgeAgg[] {
    const now = Date.now();
    // GC outside the sliding window. Cheap because new events arrive at the end.
    while (telemetry.length && now - telemetry[0]!.ts > TELEMETRY_WINDOW_MS) {
      telemetry.shift();
    }
    const byKey = new Map<string, RawCall[]>();
    for (const c of telemetry) {
      const k = c.from + '→' + c.to;
      const arr = byKey.get(k);
      if (arr) arr.push(c); else byKey.set(k, [c]);
    }
    const out: EdgeAgg[] = [];
    for (const calls of byKey.values()) {
      const first = calls[0]!;
      const durations = calls.map((c) => c.durationMs).sort((a, b) => a - b);
      const p95Idx = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
      const errors = calls.filter((c) => !c.ok);
      const recentErrors = errors.filter((c) => now - c.ts < 5_000);
      const breakerOpen = errors.some((c) => c.errorName === 'BrokenCircuitError');
      out.push({
        from: first.from,
        to: first.to,
        count: calls.length,
        errorCount: errors.length,
        p95: durations[p95Idx] ?? 0,
        breakerOpen,
        retryBurst: recentErrors.length >= 2 && !breakerOpen,
      });
    }
    return out;
  }

  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) {
      try {
        c.res.write(payload);
      } catch {
        clients.delete(c);
      }
    }
  }

  function snapshot() {
    return {
      graph,
      services: services.map((s) => ({
        name: s.name,
        port: s.port,
        status: state.get(s.name)?.status ?? 'starting',
      })),
      edges: recomputeEdges(),
    };
  }

  // ── Health polling: flip nodes up / down by hitting /healthcheck ──────────
  // Triggered manually now — on dashboard load (via the initial snapshot the
  // SSE stream serves) and on the user clicking "Refresh" in the UI. No
  // background interval, so service stdout isn't spammed with healthcheck
  // hits while the user isn't watching.
  async function pollOnce(): Promise<void> {
    await Promise.all(
      services.map(async (s) => {
        if (s.port == null) return;
        const prev = state.get(s.name)!;
        let next: Status;
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), HEALTH_TIMEOUT_MS);
          const r = await fetch(`http://localhost:${s.port}/healthcheck`, {
            signal: ac.signal,
          });
          clearTimeout(t);
          next = r.ok ? 'up' : 'down';
        } catch {
          next = 'down';
        }
        if (next !== prev.status) {
          prev.status = next;
          broadcast('status', { name: s.name, status: next });
        }
      }),
    );
  }

  const server = createServer((req, res) => handle(req, res));

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml);
      return;
    }

    if (url === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot()));
      return;
    }

    // Per-service log backfill so a tab opened mid-run isn't blank.
    if (url.startsWith('/api/logs/')) {
      const name = decodeURIComponent(url.slice('/api/logs/'.length));
      const s = state.get(name);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ logs: s?.logs ?? [] }));
      return;
    }

    // Full trace correlation for the MCP `explain_trace` tool: every peer
    // call recorded under this trace id (across services), plus log lines
    // from each service that mentioned the same id. Pino structured logs
    // include `traceId` as a JSON field; pretty-printed dev logs include it
    // as an indented `traceId: "..."` line — we match both shapes.
    // Trace index — small summary cards for the dashboard's Traces tab. Newest
    // first; the heavyweight `/api/trace/:id` is only fetched when the user
    // selects one. Cap at the most recent 50 even if the store holds more.
    if (url === '/api/traces') {
      const summaries: {
        traceId: string;
        startedAt: number;
        durationMs: number;
        callCount: number;
        failureCount: number;
        entry: { from: string; to: string; method: string } | null;
        services: string[];
      }[] = [];
      // Map.values() iterates in insertion order = oldest → newest. We want
      // newest → oldest in the UI, so collect then reverse.
      for (const [tid, calls] of traceStore) {
        if (calls.length === 0) continue;
        const startedAt = calls[0]!.ts;
        const endedAt = calls[calls.length - 1]!.ts + calls[calls.length - 1]!.durationMs;
        const failureCount = calls.filter((c) => !c.ok).length;
        const services = Array.from(new Set(calls.flatMap((c) => [c.from, c.to])));
        const root = calls[0]!;
        summaries.push({
          traceId: tid,
          startedAt,
          durationMs: Math.max(0, endedAt - startedAt),
          callCount: calls.length,
          failureCount,
          entry: { from: root.from, to: root.to, method: root.method },
          services,
        });
      }
      summaries.reverse();
      const limited = summaries.slice(0, 50);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ traces: limited, total: summaries.length }));
      return;
    }

    if (url.startsWith('/api/trace/')) {
      const tid = decodeURIComponent(url.slice('/api/trace/'.length));
      const calls = traceStore.get(tid) ?? [];
      const logs: { service: string; line: string; stream: 'out' | 'err'; ts: number }[] = [];
      const needle = `"traceId":"${tid}"`;
      const prettyNeedle = `traceId: "${tid}"`;
      for (const [svcName, svcState] of state) {
        for (const line of svcState.logs) {
          if (line.line.includes(needle) || line.line.includes(prettyNeedle)) {
            logs.push({ service: svcName, line: line.line, stream: line.stream, ts: line.ts });
          }
        }
      }
      logs.sort((a, b) => a.ts - b.ts);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          traceId: tid,
          callCount: calls.length,
          logCount: logs.length,
          calls,
          logs,
        }),
      );
      return;
    }

    // Peer-call telemetry ingest — services POST events here (XENOSIS_TELEMETRY_URL).
    // Size cap protects against a misbehaving client; we read+drop on overflow.
    if (url === '/api/telemetry' && method === 'POST') {
      let total = 0;
      const chunks: Buffer[] = [];
      let overflowed = false;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > TELEMETRY_BODY_LIMIT) {
          overflowed = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        res.writeHead(204).end();
        if (overflowed || chunks.length === 0) return;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (body && body.kind === 'peer-call' && typeof body.from === 'string' && typeof body.to === 'string') {
            const ts = Number(body.ts) || Date.now();
            telemetry.push({
              from: body.from,
              to: body.to,
              durationMs: Number(body.durationMs) || 0,
              ok: !!body.ok,
              status: body.status ?? null,
              errorName: body.errorName,
              ts,
            });
            // Index by traceId for `explain_trace`. Re-insert to refresh LRU order.
            if (typeof body.traceId === 'string' && body.traceId.length > 0) {
              const tid = body.traceId;
              const existing = traceStore.get(tid) ?? [];
              existing.push({
                from: body.from,
                to: body.to,
                method: String(body.method ?? ''),
                httpMethod: String(body.httpMethod ?? ''),
                path: String(body.path ?? ''),
                status: body.status ?? null,
                durationMs: Number(body.durationMs) || 0,
                ok: !!body.ok,
                errorName: body.errorName,
                requestBody: redactStored(body.requestBody),
                responseBody: redactStored(body.responseBody),
                spanId: body.spanId,
                parentSpanId: body.parentSpanId,
                ts,
              });
              traceStore.delete(tid);
              traceStore.set(tid, existing);
              // Evict the oldest trace ids when we exceed the cap.
              while (traceStore.size > TRACE_MAX_IDS) {
                const oldest = traceStore.keys().next().value;
                if (oldest === undefined) break;
                traceStore.delete(oldest);
              }
              // Notify connected browsers that this trace changed. Debounced
              // per-id so a 50-call burst on the same trace doesn't flood the
              // SSE stream — at most one summary every TRACE_BROADCAST_DEBOUNCE_MS.
              scheduleTraceBroadcast(tid);
            }
          }
        } catch {
          /* malformed event — ignore, telemetry must not block the app */
        }
      });
      return;
    }

    // Manual re-poll. Reply once the round-trip is done so the UI can stop
    // the spinner. Status changes go out over SSE as usual.
    if (url === '/api/refresh' && method === 'POST') {
      pollOnce()
        .then(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...snapshot() }));
        })
        .catch((err: Error) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      return;
    }

    if (url === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      const client: SseClient = { res };
      clients.add(client);
      // Prime the new connection with the current snapshot.
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      req.on('close', () => clients.delete(client));
      return;
    }

    res.writeHead(404).end();
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(opts.port, () => {
      server.off('error', reject);
      resolveListen();
    });
  });

  // One initial poll so the dashboard isn't blank for the user who just
  // opened the browser. From there on, refreshes are user-driven.
  void pollOnce();

  // Edges tick: every second, broadcast new heat-map aggregates IF the JSON
  // has actually changed. Saves bytes when the workspace is idle. Same tick
  // also GCs the trace store so it doesn't grow unboundedly between calls.
  const edgesTimer = setInterval(() => {
    // GC trace store: drop traces whose newest call is older than the window.
    const now = Date.now();
    for (const [tid, calls] of traceStore) {
      const newest = calls[calls.length - 1]?.ts ?? 0;
      if (now - newest > TRACE_WINDOW_MS) traceStore.delete(tid);
    }
    if (clients.size === 0) return; // no browsers — don't bother
    const edges = recomputeEdges();
    const json = JSON.stringify(edges);
    if (json !== lastEdgesJson) {
      lastEdgesJson = json;
      broadcast('edges', edges);
    }
  }, TELEMETRY_TICK_MS);

  const url = `http://localhost:${opts.port}`;

  return {
    url,
    pushLog(pkgName, line, stream) {
      const name = pkgToName.get(pkgName);
      if (!name) return;
      const s = state.get(name);
      if (!s) return;
      const entry = { line, stream, ts: Date.now() };
      s.logs.push(entry);
      if (s.logs.length > LOG_RING) s.logs.shift();
      broadcast('log', { name, ...entry });
    },
    async close() {
      clearInterval(edgesTimer);
      for (const t of pendingTraceBroadcasts.values()) clearTimeout(t);
      pendingTraceBroadcasts.clear();
      for (const c of clients) {
        try {
          c.res.end();
        } catch {
          /* already gone */
        }
      }
      clients.clear();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
