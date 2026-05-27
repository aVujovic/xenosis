import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type {
  SocketTransport,
  TransportConnection,
  TransportHandle,
  TransportMountOptions,
} from './types';

/**
 * Default transport: plain WebSockets backed by the `ws` package. Mounted
 * automatically when a socket binding omits the `transport` field, or
 * sets it to `"ws"`. Lives in core so the common case is zero-install.
 *
 * Per-connection heartbeat is owned here, not by the loader: it's a
 * transport concern. Default interval is 30s; can be overridden via
 * `transportOptions.heartbeatMs` in the binding.
 */

const PING_INTERVAL_MS_DEFAULT = 30_000;

class WsConnection implements TransportConnection {
  readonly id: string;
  readonly userId: string | undefined;
  readonly headers: Record<string, string | string[] | undefined>;
  private ws: WebSocket;
  private closeHandlers: (() => void)[] = [];

  constructor(
    ws: WebSocket,
    userId: string | undefined,
    headers: Record<string, string | string[] | undefined>,
  ) {
    this.id = randomUUID();
    this.userId = userId;
    this.headers = headers;
    this.ws = ws;
  }

  send(frame: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  close(code = 1000, reason?: string): void {
    try { this.ws.close(code, reason); } catch { /* already closed */ }
  }

  onMessage(handler: (frame: string) => void): void {
    this.ws.on('message', (raw: RawData) => {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf-8') : '';
      if (text) handler(text);
    });
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
    this.ws.once('close', () => {
      for (const fn of this.closeHandlers) {
        try { fn(); } catch { /* swallow; framework logs */ }
      }
    });
  }

  onError(handler: (err: Error) => void): void {
    this.ws.on('error', handler);
  }

  /** Provider-internal — heartbeat helper. */
  ping(): void { try { this.ws.ping(); } catch { /* */ } }
  /** Provider-internal — heartbeat helper. */
  terminate(): void { try { this.ws.terminate(); } catch { /* */ } }
  /** Provider-internal — heartbeat helper. */
  get raw(): WebSocket { return this.ws; }
}

const wsTransport: SocketTransport = {
  name: 'ws',
  mount(opts: TransportMountOptions): TransportHandle {
    const wss = new WebSocketServer({ noServer: true });
    const conns = new Set<WsConnection>();
    const heartbeatMs = Number(opts.options?.heartbeatMs) || PING_INTERVAL_MS_DEFAULT;

    const upgradeHandler = async (
      req: import('node:http').IncomingMessage,
      socket: import('node:net').Socket,
      head: Buffer,
    ): Promise<void> => {
      // Each transport instance only handles its own path; others get
      // their own `upgrade` listener on the same http server.
      const reqPath = (req.url ?? '/').split('?')[0]!;
      if (reqPath !== opts.path) return;

      let authResult: { userId: string | undefined } | null;
      try {
        authResult = await opts.authenticate(req);
      } catch {
        authResult = null;
      }
      if (!authResult) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = new WsConnection(ws, authResult!.userId, req.headers);
        conns.add(conn);
        // Heartbeat plumbing: ws marks itself alive on every pong.
        (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
        ws.on('pong', () => {
          (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
        });
        ws.once('close', () => conns.delete(conn));
        opts.onConnect(conn);
      });
    };

    opts.httpServer.on('upgrade', upgradeHandler);

    const heartbeatTimer = setInterval(() => {
      for (const conn of conns) {
        const alive = (conn.raw as WebSocket & { isAlive?: boolean }).isAlive ?? false;
        if (!alive) { conn.terminate(); continue; }
        (conn.raw as WebSocket & { isAlive?: boolean }).isAlive = false;
        conn.ping();
      }
    }, heartbeatMs);
    heartbeatTimer.unref();

    return {
      async close(): Promise<void> {
        clearInterval(heartbeatTimer);
        opts.httpServer.off('upgrade', upgradeHandler);
        for (const conn of conns) conn.terminate();
        conns.clear();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
      },
    };
  },
};

export default wsTransport;
