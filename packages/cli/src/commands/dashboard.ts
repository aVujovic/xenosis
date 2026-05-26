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
