import type { IncomingMessage, Server as HttpServer } from 'node:http';

/**
 * Transport-level connection abstraction. The loader owns everything
 * domain-level (channels, users, scopes, zod dispatch); the transport
 * provider only owns the wire — how to listen for upgrades, how to send a
 * frame, how to notice a close. That split lets us drop in alternative
 * transports (socket.io, uWebSockets.js, raw TCP, …) without rewriting
 * the framework code that consumes them.
 *
 * A `TransportConnection` is a single live connection. Every call below
 * MUST be safe to invoke after the underlying socket has closed
 * (no-op rather than throw) — the loader has to clean up its own bookkeeping
 * defensively when domain logic asks the connection to do something racy.
 */
export interface TransportConnection {
  /** Stable, unique id for this connection. The transport assigns it. */
  readonly id: string;
  /** Authenticated user id from the upgrade handshake, when present.
   *  The transport only carries this value; it doesn't decide auth. The
   *  `authenticate` hook in `TransportMountOptions` is what returns it. */
  readonly userId: string | undefined;
  /** Upgrade-request headers, exposed for trace propagation and any
   *  loader-side bookkeeping. The transport snapshots them at connect
   *  time; mutating them post-hoc has no effect. Optional because some
   *  transports (e.g. simulated test connections) may not have an HTTP
   *  upgrade behind them. */
  readonly headers?: Record<string, string | string[] | undefined>;
  /** Send a single text frame. JSON encoding is the loader's responsibility. */
  send(frame: string): void;
  /** Initiate a graceful close. Provider best-effort maps `code` to its
   *  closest concept — for `ws`, that's the WebSocket close code. */
  close(code?: number, reason?: string): void;
  /** Receive every text frame the client sends. Binary frames are decoded
   *  to strings by the provider (utf-8). */
  onMessage(handler: (frame: string) => void): void;
  /** Called once when the connection ends, for any reason. */
  onClose(handler: () => void): void;
  /** Called on transport-level errors (ping timeout, parse fail, …).
   *  The loader logs and otherwise ignores — close handler still runs. */
  onError(handler: (err: Error) => void): void;
}

/** What the loader hands to a transport when it asks it to mount a path. */
export interface TransportMountOptions {
  /** The shared http.Server the framework already owns. Transports
   *  attach by listening for `upgrade` on it and routing by `req.url`. */
  httpServer: HttpServer;
  /** The path the transport should handle. Anything else is left alone. */
  path: string;
  /** Auth gate. Loader calls this on every upgrade; provider rejects the
   *  upgrade itself when this returns `null`. Returning `{ userId }` lets
   *  through; `userId` is the value that will live on `conn.userId`. */
  authenticate(req: IncomingMessage): Promise<{ userId: string | undefined } | null>;
  /** Called once per established connection. Loader hooks up its own
   *  `onMessage`/`onClose` here. */
  onConnect(conn: TransportConnection): void;
  /** Optional provider-specific options forwarded verbatim. Forwarded
   *  from `config.sockets.<name>.transportOptions`. */
  options?: Record<string, unknown>;
}

/** Returned by `mount(...)`. The loader holds it for the lifetime of the
 *  service and calls `close()` on shutdown. */
export interface TransportHandle {
  /** Stop accepting new upgrades, close active connections, release
   *  resources. Resolves when the cleanup is complete. */
  close(): Promise<void>;
}

/**
 * A pluggable transport. Default-export this from a package and reference
 * the package name in `config.sockets.<name>.transport` (e.g.
 * `"@xenosisorg/socket-transport-socketio"`). The built-in `"ws"` transport
 * is bundled inside `@xenosisorg/xenosis-core`.
 */
export interface SocketTransport {
  /** Short identifier — `"ws"`, `"socket.io"`, `"uws"`, … Used in logs only. */
  readonly name: string;
  /** Attach the transport to the http server. */
  mount(opts: TransportMountOptions): TransportHandle;
}
