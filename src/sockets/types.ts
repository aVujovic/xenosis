import type { z } from 'zod';
import type { AwilixContainer } from 'awilix';
import type { ILogger } from '../types';

/**
 * WebSocket support — same shape as the REST + peer-RPC layers:
 *   • `defineSocketApi(...)` declares the contract (path, message schemas,
 *     channel layout) in an API package, just like `defineServiceApi`.
 *   • A service-side handler class lives in `src/sockets/<name>.socket.ts`
 *     and is picked up by the `sockets` autoload category.
 *   • The cradle exposes a `socketBus` so non-socket code (cron jobs, peer
 *     handlers, redis subscribers) can broadcast without holding a handle
 *     to the underlying ws instances.
 *
 * Library: `ws` (Node-native, industry default).
 */

/** A zod schema for inbound (client → server) or outbound (server → client) messages. */
export type MessageSchema = z.ZodTypeAny;

/** A single channel declaration. Empty object = static channel name. */
export interface ChannelSpec {
  /** Optional zod schema for path params when the channel is dynamic.
   *  E.g. `room` channel with `paramSchema = z.object({ roomId: z.string() })`
   *  → clients subscribe to `room:r1`, `room:r2`, … */
  paramSchema?: z.ZodTypeAny;
}

/**
 * The public contract shared between socket server (handler) and any peer
 * service that wants to broadcast outbound messages through `socketBus`.
 * `defineSocketApi(...)` returns this shape.
 */
export interface SocketApi<
  TClient extends Record<string, MessageSchema> = Record<string, MessageSchema>,
  TServer extends Record<string, MessageSchema> = Record<string, MessageSchema>,
  TChannels extends Record<string, ChannelSpec> = Record<string, ChannelSpec>,
> {
  /** Short, kebab-case identifier — e.g. 'chat', 'live-trades'. Used as
   *  the cradle key (`chatSocket`) and the SocketApi cradle aggregator. */
  name: string;
  /** HTTP path the WebSocket server listens on — e.g. '/ws/chat'. */
  path: string;
  /** Messages clients can send. Each handler method receives the parsed
   *  body typed from the matching schema. */
  clientMessages: TClient;
  /** Messages the server emits. Used to type `socketBus.broadcastToChannel`
   *  / `sendToUser` and to validate outbound payloads in dev. */
  serverMessages: TServer;
  /** Declared channels. Subscriptions to anything outside this list are
   *  rejected at runtime (defence-in-depth on top of allow-listing). */
  channels: TChannels;
  /** Optional flag — `external: true` lets a service consume a third-party
   *  WebSocket (analogous to `peers --external`); the loader skips
   *  mounting a server endpoint and only registers the client side.
   *  Reserved for future use. */
  external?: boolean;
}

/** Infer the message body type a handler method receives from a zod schema. */
export type MessageBody<S extends MessageSchema> = z.infer<S>;

/**
 * The per-connection context a handler method receives. Mirrors the
 * per-request context the REST stack uses, plus broadcast helpers.
 */
export interface SocketContext {
  /** Authenticated user id (from JWT or auth handshake). Undefined if the
   *  socket allows unauthenticated connections. */
  userId: string | undefined;
  /** Stable connection id — useful for log correlation and tests. */
  connectionId: string;
  /** Trace id propagated from the upgrade request, or fresh on each
   *  connection if none was supplied. Convenience accessor — same value
   *  as `trace.traceId`. */
  traceId: string;
  /** Full trace context (traceId + spanId + parentSpanId). Identical
   *  shape to the REST request's `req.traceContext`; carry it through
   *  any outbound peer calls to keep one trace across hops. */
  trace: { traceId: string; spanId: string; parentSpanId?: string };
  /** Awilix scope created on connect; disposed on disconnect. Sibling of
   *  `req.scope` in the REST stack. */
  scope: AwilixContainer;
  /** Child logger bound to `{ traceId, connectionId, userId, socket: <name> }`. */
  logger: ILogger;
  /** Send a single message back to *this* connected client. */
  send(message: unknown): void;
  /** Subscribe this connection to a channel. The channel name must match
   *  one declared in the SocketApi (`channels`) — dynamic params allowed
   *  using the `prefix:value` convention (e.g. 'room:r1'). */
  subscribe(channel: string): void;
  /** Unsubscribe from a channel. */
  unsubscribe(channel: string): void;
  /** Fan-out a message to everyone subscribed to `channel`. */
  broadcastToChannel(channel: string, message: unknown): void;
  /** Send a message to all of `userId`'s active connections. No-op if the
   *  user is not currently connected to this socket. */
  sendToUser(userId: string, message: unknown): void;
}

/**
 * Method signature derived from a clientMessages schema. The loader builds
 * one of these per declared message and dispatches by the `type` field on
 * every inbound frame.
 */
export type SocketMethodFn<S extends MessageSchema> = (
  ctx: SocketContext,
  body: MessageBody<S>,
) => unknown | Promise<unknown>;

/**
 * Shape every user-land handler class implements. The keys must match the
 * clientMessages declared in the SocketApi — TypeScript enforces this at
 * compile time when the user types the class as
 *   `class FooSocket implements SocketHandler<typeof fooSocketApi>`.
 *
 * The lifecycle hooks (`onConnect` / `onDisconnect`) are optional.
 */
export type SocketHandler<TApi extends SocketApi> = {
  onConnect?(ctx: SocketContext): unknown | Promise<unknown>;
  onDisconnect?(ctx: SocketContext): unknown | Promise<unknown>;
} & {
  [K in keyof TApi['clientMessages']]: SocketMethodFn<TApi['clientMessages'][K]>;
};

/**
 * The cradle entry exposed to non-socket code (cron, services, peer
 * handlers). Holds no per-connection state; routes messages through the
 * loader-owned WS server.
 */
export interface SocketBus {
  /** Send to every connection subscribed to `channel`. */
  broadcastToChannel(channel: string, message: unknown): void;
  /** Send to every connection authenticated as `userId`. */
  sendToUser(userId: string, message: unknown): void;
  /** Force-disconnect every connection authenticated as `userId`. */
  disconnect(userId: string, reason?: string): void;
  /** Snapshot of currently active connections, for telemetry / debugging. */
  stats(): {
    socketName: string;
    connections: number;
    /** channel → subscriber count */
    channels: Record<string, number>;
    /** userId → connection count */
    users: Record<string, number>;
  }[];
}
