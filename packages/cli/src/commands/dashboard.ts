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

  interface EdgeAgg {
    from: string; to: string;
    count: number;
    errorCount: number;
    p95: number; // ms
    breakerOpen: boolean;
    retryBurst: boolean; // ≥2 errors in last 5s for this edge
  }
  let lastEdgesJson = '[]';

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
            telemetry.push({
              from: body.from,
              to: body.to,
              durationMs: Number(body.durationMs) || 0,
              ok: !!body.ok,
              status: body.status ?? null,
              errorName: body.errorName,
              ts: Number(body.ts) || Date.now(),
            });
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
  // has actually changed. Saves bytes when the workspace is idle.
  const edgesTimer = setInterval(() => {
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
