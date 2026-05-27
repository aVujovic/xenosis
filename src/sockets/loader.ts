import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { AwilixContainer } from 'awilix';
import { asValue } from 'awilix';
import type { ILogger } from '../types';
import type { XenosisConfig } from '../config.schema';
import type { SocketApi, SocketBus, SocketContext } from './types';
import type {
  SocketTransport,
  TransportConnection,
  TransportHandle,
} from './transports/types';
import wsTransport from './transports/ws.transport';
import { importFromService } from '../libs/importFromService';
import { HTTP_SERVER } from '../runtime/server';
import { asValue as asValueCradle } from 'awilix';
import { newTrace, childSpan, readTraceFromHeaders } from '../peers/tracing';
import type { TraceContext } from '../peers/types';

/** Resolved socket binding shape after zod validation (mirrors config.schema). */
interface SocketBinding {
  package: string;
  path?: string;
  transport?: string;
  transportOptions?: Record<string, unknown>;
  requireAuth?: boolean;
  maxConnectionsPerUser?: number;
  validation?: 'strict' | 'off';
}

/**
 * Socket loader — transport-agnostic. Everything wire-level (upgrade
 * handling, ping/pong, frame encoding) lives in a `SocketTransport`
 * provider; this file owns the domain layer: channels, users, scopes,
 * zod dispatch, lifecycle hooks, `socketBus`.
 *
 * Built-in transport is `ws`. Anything else is resolved by package name
 * the same way schemas / peers / shared modules are — set
 * `config.sockets.<name>.transport` to either the literal `"ws"` or an npm
 * package name that default-exports a `SocketTransport`. That keeps the
 * door open for `@xenosisorg/socket-transport-socketio`, `…-uws`, …
 * without forking the loader.
 */

/** Per-connection state owned by the loader (not the transport). */
interface ConnState {
  connectionId: string;
  userId: string | undefined;
  channels: Set<string>;
  scope: AwilixContainer;
  logger: ILogger;
  conn: TransportConnection;
  trace: TraceContext;
}

/** Per-SocketApi bookkeeping. In-memory; sockets are per-process. */
interface SocketRegistry {
  api: SocketApi;
  /** All currently connected sockets. */
  conns: Set<TransportConnection>;
  /** channel → connections subscribed to that channel. */
  channels: Map<string, Set<TransportConnection>>;
  /** userId → that user's currently connected sockets. */
  users: Map<string, Set<TransportConnection>>;
  /** conn → loader-side state. WeakMap so closed sockets get GCed. */
  state: WeakMap<TransportConnection, ConnState>;
  /** Provider handle, used to tear the transport down on shutdown. */
  handle: TransportHandle;
  /** When 'off', dispatch skips zod validation and forwards the raw parsed
   *  body. Defaults to 'strict' (validate against clientMessages schema). */
  validation: 'strict' | 'off';
}

/* ─── public entry point ─────────────────────────────────────────────────── */

export async function loadSockets(
  container: AwilixContainer,
  config: XenosisConfig,
  logger: ILogger,
): Promise<{ disconnects: (() => Promise<void> | void)[] }> {
  const registries: SocketRegistry[] = [];

  // Register a no-op bus first so any code that depends on `socketBus`
  // can resolve even when this service declares no sockets. We swap it
  // for the real one after the registries are populated below.
  container.register({ socketBus: asValue(buildBus(registries)) });

  const bindings = config.sockets;
  if (!bindings || Object.keys(bindings).length === 0) return { disconnects: [] };

  // The http.Server was attached to the Express app by the server provider.
  const expressApp = container.cradle.server as object;
  const httpServer = (expressApp as Record<symbol, HttpServer | undefined>)[HTTP_SERVER];
  if (!httpServer) {
    logger.warn(
      '[xenosis/sockets] config.sockets is set but no HTTP server was attached to the Express app — skipping.',
    );
    return { disconnects: [] };
  }

  for (const [name, rawBinding] of Object.entries(bindings)) {
    const binding = rawBinding as SocketBinding;
    const apiModule = (await importFromService(binding.package)) as Record<string, unknown>;
    const api =
      (typeof apiModule.default === 'object' && apiModule.default
        ? (apiModule.default as SocketApi)
        : undefined) ?? (apiModule.socketApi as SocketApi | undefined);
    if (!api || typeof api !== 'object' || !api.path) {
      throw new Error(
        `[xenosis/sockets] sockets.${name}: package "${binding.package}" must default-export a SocketApi (use defineSocketApi).`,
      );
    }

    // Handler is autoloaded as `<api.name>Socket` (e.g. SocketApi.name = 'chat'
    // → src/sockets/chat.socket.ts → cradle key `chatSocket`).
    const handlerKey = `${api.name}Socket`;
    const handler = (container.cradle as Record<string, unknown>)[handlerKey];
    if (!handler || typeof handler !== 'object') {
      throw new Error(
        `[xenosis/sockets] sockets.${name}: no handler found in cradle as "${handlerKey}". ` +
          `Add src/sockets/${api.name}.socket.ts with a default-exported class.`,
      );
    }

    const path = binding.path ?? api.path;
    const transport = await resolveTransport(binding.transport);

    const reg: SocketRegistry = {
      api,
      conns: new Set(),
      channels: new Map(),
      users: new Map(),
      state: new WeakMap(),
      handle: undefined as unknown as TransportHandle, // assigned below
      validation: binding.validation ?? 'strict',
    };

    reg.handle = transport.mount({
      httpServer,
      path,
      ...(binding.transportOptions ? { options: binding.transportOptions } : {}),
      authenticate: (req) =>
        runAuthenticate(
          req,
          binding.requireAuth ?? false,
          binding.maxConnectionsPerUser,
          reg,
          handler as Record<string, unknown>,
          logger,
        ),
      onConnect: (conn) => onConnection(conn, reg, container, handler as Record<string, unknown>, logger),
    });

    registries.push(reg);
    logger.info(
      `📡 Socket loaded: ${api.name} ← ${binding.package} (transport=${transport.name}, path=${path})`,
    );
  }

  // Replace the no-op bus with one that fan-outs across every populated
  // registry. Late re-registration overwrites the earlier asValue.
  container.register({ socketBus: asValue(buildBus(registries)) });

  const disconnects = registries.map((reg) => async () => {
    reg.channels.clear();
    reg.users.clear();
    reg.conns.clear();
    await reg.handle.close();
  });
  return { disconnects };
}

/* ─── transport resolution ───────────────────────────────────────────────── */

async function resolveTransport(name: string | undefined): Promise<SocketTransport> {
  if (!name || name === 'ws') return wsTransport;
  // Anything else is a package name — same resolution path as schemas / peers.
  const mod = (await importFromService(name)) as Record<string, unknown>;
  const t =
    (typeof mod.default === 'object' && mod.default
      ? (mod.default as SocketTransport)
      : undefined) ?? (mod.transport as SocketTransport | undefined);
  if (!t || typeof t.mount !== 'function') {
    throw new Error(
      `[xenosis/sockets] transport "${name}" did not default-export a SocketTransport (need a { name, mount() } shape).`,
    );
  }
  return t;
}

/* ─── auth + per-binding limits ──────────────────────────────────────────── */

/**
 * Auth gate run by the transport on every upgrade. Returns `null` to refuse
 * the upgrade (transport replies 401); returns `{ userId }` (possibly with
 * `userId: undefined` for anonymous-allowed sockets) on success.
 *
 * Auth resolution order:
 *   1. Extract a bearer token (`?token=...` query or
 *      `Sec-WebSocket-Protocol: bearer.<jwt>` header).
 *   2. If the handler exports an `authenticate(token)` method, call it —
 *      the handler returns `{ userId }` to accept, or throws / returns null
 *      to reject. This is where userland verifies the JWT signature and
 *      decodes claims, with whatever lib it wants (jose, jsonwebtoken, …).
 *   3. If no `authenticate` method is exported and `requireAuth: true`, we
 *      accept the connection with a userId set to the raw token (a useful
 *      default for development; production code should always provide an
 *      `authenticate` method).
 *   4. Enforce `maxConnectionsPerUser` if configured.
 */
async function runAuthenticate(
  req: IncomingMessage,
  requireAuth: boolean,
  maxPerUser: number | undefined,
  reg: SocketRegistry,
  handler: Record<string, unknown>,
  logger: ILogger,
): Promise<{ userId: string | undefined } | null> {
  const tokenInfo = extractAuthToken(req);
  if (requireAuth && !tokenInfo) return null;

  let userId: string | undefined = undefined;

  const authFn = handler.authenticate;
  if (typeof authFn === 'function') {
    try {
      const result = (await (authFn as (token: string | undefined) => unknown)(
        tokenInfo?.token,
      )) as { userId?: string } | null | undefined;
      if (!result) {
        if (requireAuth) return null;
      } else if (typeof result.userId === 'string') {
        userId = result.userId;
      }
    } catch (err) {
      logger.warn({ err, socket: reg.api.name }, 'socket: authenticate() threw — refusing upgrade');
      return null;
    }
  } else if (tokenInfo) {
    // No handler-side validation but a token is present — treat the raw
    // token as the user id. Acceptable for development; production code
    // should always provide an `authenticate` method.
    userId = tokenInfo.token;
  }

  if (maxPerUser && userId) {
    const existing = reg.users.get(userId)?.size ?? 0;
    if (existing >= maxPerUser) return null;
  }
  return { userId };
}

function extractAuthToken(req: IncomingMessage): { token: string; userId: string | undefined } | undefined {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const qToken = url.searchParams.get('token');
  if (qToken) return { token: qToken, userId: undefined };

  const protocolHeader = req.headers['sec-websocket-protocol'];
  if (typeof protocolHeader === 'string') {
    const parts = protocolHeader.split(',').map((s) => s.trim());
    const bearer = parts.find((p) => p.startsWith('bearer.'));
    if (bearer) return { token: bearer.slice('bearer.'.length), userId: undefined };
  }
  return undefined;
}

/* ─── per-connection wiring ──────────────────────────────────────────────── */

function onConnection(
  conn: TransportConnection,
  reg: SocketRegistry,
  container: AwilixContainer,
  handler: Record<string, unknown>,
  logger: ILogger,
): void {
  // Trace propagation: inherit from upgrade headers (one trace across the
  // HTTP-handshake + every WS message) or start a fresh trace per connect.
  const inboundTrace = conn.headers ? readTraceFromHeaders(conn.headers) : null;
  const trace: TraceContext = inboundTrace ? childSpan(inboundTrace) : newTrace();

  const scope = container.createScope();
  scope.register({
    traceContext: asValueCradle(trace),
    // currentUser is the same cradle key the REST middleware uses, so
    // services/repositories injected into handlers can read it the same way.
    currentUser: asValueCradle(conn.userId ? { id: conn.userId } : null),
  });

  const childLogger = logger.child({
    socket: reg.api.name,
    connectionId: conn.id,
    traceId: trace.traceId,
    spanId: trace.spanId,
    ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
    ...(conn.userId ? { userId: conn.userId } : {}),
  });
  scope.register({ requestLogger: asValueCradle(childLogger) });

  const state: ConnState = {
    connectionId: conn.id,
    userId: conn.userId,
    channels: new Set(),
    scope,
    logger: childLogger,
    conn,
    trace,
  };
  reg.state.set(conn, state);
  reg.conns.add(conn);
  if (conn.userId) {
    let set = reg.users.get(conn.userId);
    if (!set) { set = new Set(); reg.users.set(conn.userId, set); }
    set.add(conn);
  }

  const ctx = buildSocketContext(reg, state);

  invokeHandler(handler, 'onConnect', ctx, undefined, childLogger);

  conn.onMessage((frame) => dispatch(frame, reg, handler, ctx, state, childLogger));
  conn.onClose(() => {
    for (const ch of state.channels) {
      reg.channels.get(ch)?.delete(conn);
      if (reg.channels.get(ch)?.size === 0) reg.channels.delete(ch);
    }
    if (conn.userId) {
      const set = reg.users.get(conn.userId);
      if (set) {
        set.delete(conn);
        if (set.size === 0) reg.users.delete(conn.userId);
      }
    }
    reg.conns.delete(conn);
    invokeHandler(handler, 'onDisconnect', ctx, undefined, childLogger);
  });
  conn.onError((err) => childLogger.error({ err }, 'socket: connection error'));
}

function dispatch(
  frame: string,
  reg: SocketRegistry,
  handler: Record<string, unknown>,
  ctx: SocketContext,
  state: ConnState,
  logger: ILogger,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    logger.warn('socket: ignoring non-JSON message');
    return;
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
    logger.warn('socket: ignoring message without `type`');
    return;
  }
  const type = (parsed as { type: string }).type;

  // Built-in control messages (channel subscribe/unsubscribe).
  if (type === 'subscribe' && typeof (parsed as { channel?: unknown }).channel === 'string') {
    ctx.subscribe((parsed as { channel: string }).channel);
    return;
  }
  if (type === 'unsubscribe' && typeof (parsed as { channel?: unknown }).channel === 'string') {
    ctx.unsubscribe((parsed as { channel: string }).channel);
    return;
  }

  const schema = reg.api.clientMessages[type];
  const fn = handler[type];
  if (typeof fn !== 'function') {
    logger.warn({ type }, `socket: no handler method for "${type}"`);
    return;
  }
  const { type: _drop, ...body } = parsed as { type: string; [k: string]: unknown };

  // Validation mode:
  //  • 'strict' (default): every recognised type MUST have a clientMessages
  //    schema, and the payload MUST parse. Anything else is dropped + warned.
  //  • 'off': forward the raw parsed body — handler is responsible for any
  //    runtime checks. Useful when migrating code that already validates
  //    by hand, or when the SocketApi is still being typed.
  if (reg.validation === 'strict') {
    if (!schema) {
      logger.warn({ type }, 'socket: unknown message type');
      return;
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      logger.warn({ type, issues: result.error.issues }, 'socket: payload validation failed');
      state.conn.send(JSON.stringify({ type: 'error', forType: type, issues: result.error.issues }));
      return;
    }
    Promise.resolve()
      .then(() => (fn as (...args: unknown[]) => unknown).call(handler, ctx, result.data))
      .catch((err: Error) => logger.error({ err, type }, 'socket: handler threw'));
    return;
  }

  // validation === 'off': raw body straight through.
  Promise.resolve()
    .then(() => (fn as (...args: unknown[]) => unknown).call(handler, ctx, body))
    .catch((err: Error) => logger.error({ err, type }, 'socket: handler threw'));
}

/* ─── per-context helpers ────────────────────────────────────────────────── */

function buildSocketContext(reg: SocketRegistry, state: ConnState): SocketContext {
  return {
    userId: state.userId,
    connectionId: state.connectionId,
    traceId: state.trace.traceId,
    trace: state.trace,
    scope: state.scope,
    logger: state.logger,
    send(message) {
      state.conn.send(JSON.stringify(message));
    },
    subscribe(channel) {
      if (!isChannelAllowed(reg.api, channel)) {
        state.logger.warn({ channel }, 'socket: subscribe rejected — channel not declared');
        return;
      }
      state.channels.add(channel);
      let set = reg.channels.get(channel);
      if (!set) { set = new Set(); reg.channels.set(channel, set); }
      set.add(state.conn);
    },
    unsubscribe(channel) {
      state.channels.delete(channel);
      const set = reg.channels.get(channel);
      if (set) {
        set.delete(state.conn);
        if (set.size === 0) reg.channels.delete(channel);
      }
    },
    broadcastToChannel(channel, message) {
      const set = reg.channels.get(channel);
      if (!set) return;
      const frame = JSON.stringify(message);
      for (const peer of set) peer.send(frame);
    },
    sendToUser(userId, message) {
      const set = reg.users.get(userId);
      if (!set) return;
      const frame = JSON.stringify(message);
      for (const peer of set) peer.send(frame);
    },
  };
}

/** Channel allow-list: declared key OR `<key>:<param>` when the spec has a paramSchema. */
function isChannelAllowed(api: SocketApi, channel: string): boolean {
  if (api.channels[channel]) return true;
  const colonIdx = channel.indexOf(':');
  if (colonIdx <= 0) return false;
  const prefix = channel.slice(0, colonIdx);
  const spec = api.channels[prefix];
  return !!spec?.paramSchema;
}

function invokeHandler(
  handler: Record<string, unknown>,
  method: string,
  ctx: SocketContext,
  body: unknown,
  logger: ILogger,
): void {
  const fn = handler[method];
  if (typeof fn !== 'function') return;
  Promise.resolve()
    .then(() => (fn as (...args: unknown[]) => unknown).call(handler, ctx, body))
    .catch((err: Error) => logger.error({ err, method }, 'socket: lifecycle handler threw'));
}

/* ─── socketBus — cradle-exposed fan-out ──────────────────────────────────── */

function buildBus(registries: SocketRegistry[]): SocketBus {
  return {
    broadcastToChannel(channel, message) {
      const frame = JSON.stringify(message);
      for (const reg of registries) {
        const set = reg.channels.get(channel);
        if (!set) continue;
        for (const peer of set) peer.send(frame);
      }
    },
    sendToUser(userId, message) {
      const frame = JSON.stringify(message);
      for (const reg of registries) {
        const set = reg.users.get(userId);
        if (!set) continue;
        for (const peer of set) peer.send(frame);
      }
    },
    disconnect(userId, reason) {
      for (const reg of registries) {
        const set = reg.users.get(userId);
        if (!set) continue;
        for (const peer of set) peer.close(4000, reason);
      }
    },
    stats() {
      return registries.map((reg) => ({
        socketName: reg.api.name,
        connections: reg.conns.size,
        channels: Object.fromEntries(
          Array.from(reg.channels.entries()).map(([k, v]) => [k, v.size]),
        ),
        users: Object.fromEntries(
          Array.from(reg.users.entries()).map(([k, v]) => [k, v.size]),
        ),
      }));
    },
  };
}
