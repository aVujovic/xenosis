import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { WebSocket } from 'ws';

/**
 * In-process WebSocket test helper. Listens the wrapped http.Server on a
 * random port (0 = OS picks), opens a real `ws` client to it, exposes a
 * tiny API for sending typed frames and inspecting what came back.
 *
 * Why a real port instead of a duplex pipe? Because every `SocketTransport`
 * built on top of `http.Server.upgrade` needs an actual upgrade dance —
 * the ws server can't be tricked with a fake socket. Random ports are
 * cheap; the listener lives only for the duration of the test.
 *
 * A single test typically spins up two or three clients (e.g. alice + bob)
 * to assert broadcast fan-out. Each client owns its own port-less wrapper
 * but they all share the same http server instance, so they hit the same
 * SocketRegistry.
 */

export interface SocketTestClient {
  /** Send a JSON frame with `type` prepended. Equivalent to a real
   *  client doing `ws.send(JSON.stringify({ type, ...body }))`. */
  send(type: string, body?: Record<string, unknown>): void;
  /** Subscribe this connection to a channel (built-in `subscribe` frame). */
  subscribe(channel: string): void;
  /** Unsubscribe from a channel. */
  unsubscribe(channel: string): void;
  /** All frames received from the server, oldest-first. Each entry is the
   *  parsed JSON payload. */
  received: unknown[];
  /** Wait until at least `n` messages have arrived, with a millisecond
   *  timeout. Rejects on timeout. Useful when an assertion expects a
   *  broadcast that travels through Redis or another async pipe. */
  waitFor(n: number, timeoutMs?: number): Promise<void>;
  /** Close the underlying ws cleanly. Idempotent. */
  close(): Promise<void>;
}

export interface SocketTestServer {
  /** Establish a new ws client. Token is sent as `?token=...` query param —
   *  the handler's `authenticate(token)` (if any) is what validates it. */
  connect(opts?: { token?: string; path?: string }): Promise<SocketTestClient>;
  /** Tear down the listener and every still-open test client. */
  close(): Promise<void>;
}

/**
 * Spin up the http server on an ephemeral port and return a factory that
 * opens ws clients to it. Pass `httpServer` from the test container — it's
 * the same server xenosisBootstrap has already set up; the loader has
 * already mounted its `upgrade` handler on it.
 *
 * `defaultPath` is the path the loader mounted (from `SocketApi.path` or
 * the override in `config.sockets.<name>.path`). Clients can override per
 * call.
 */
export async function createSocketTestServer(
  httpServer: HttpServer,
  defaultPath: string,
): Promise<SocketTestServer> {
  // Listen if not already listening (createTestContainer doesn't `.listen()`
  // because supertest doesn't need it; ws does).
  if (!httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      httpServer.once('error', onError);
      httpServer.listen(0, () => {
        httpServer.off('error', onError);
        resolve();
      });
    });
  }
  const addr = httpServer.address() as AddressInfo;
  const port = addr.port;
  const clients = new Set<SocketTestClient>();

  return {
    async connect(opts = {}) {
      const path = opts.path ?? defaultPath;
      const query = opts.token ? `?token=${encodeURIComponent(opts.token)}` : '';
      const url = `ws://localhost:${port}${path}${query}`;
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        ws.once('open', () => {
          ws.off('error', onError);
          resolve();
        });
        ws.once('error', onError);
      });
      const received: unknown[] = [];
      ws.on('message', (raw) => {
        try { received.push(JSON.parse(raw.toString())); } catch { /* ignore non-JSON */ }
      });
      const client: SocketTestClient = {
        received,
        send(type, body = {}) { ws.send(JSON.stringify({ type, ...body })); },
        subscribe(channel) { ws.send(JSON.stringify({ type: 'subscribe', channel })); },
        unsubscribe(channel) { ws.send(JSON.stringify({ type: 'unsubscribe', channel })); },
        async waitFor(n, timeoutMs = 1000) {
          const deadline = Date.now() + timeoutMs;
          while (received.length < n) {
            if (Date.now() > deadline) {
              throw new Error(
                `socket test client: waited ${timeoutMs}ms for ${n} message(s), got ${received.length}`,
              );
            }
            await new Promise((r) => setTimeout(r, 10));
          }
        },
        async close() {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            await new Promise<void>((r) => { ws.once('close', () => r()); ws.close(); });
          }
          clients.delete(client);
        },
      };
      clients.add(client);
      return client;
    },
    async close() {
      for (const c of clients) {
        try { await c.close(); } catch { /* swallow */ }
      }
      clients.clear();
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}
