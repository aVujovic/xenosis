import type { ZodTypeAny, z } from 'zod';
import type { AwilixContainer } from 'awilix';
import type { ILogger } from '../types.js';
import type { TraceContext } from '../peers/types.js';

/**
 * Domain-level event API contract — the typed shape of an event bus binding.
 * Lives in a shared npm package (`apis/<name>-events`), imported by both
 * producer and consumer services so the schema and topic naming are a single
 * source of truth.
 *
 * Mirrors the `definePeerApi` / `defineSocketApi` pattern for the async side.
 */
export interface EventTopicSpec<
  TKey extends ZodTypeAny | undefined = ZodTypeAny | undefined,
  TPayload extends ZodTypeAny = ZodTypeAny,
> {
  /**
   * The wire-level topic name. For Kafka/Redpanda this is a Kafka topic; for
   * NATS a subject; for Redis Streams a stream key. Loader hands it to the
   * transport untouched.
   */
  topic: string;
  /**
   * zod schema for the message payload. Validated on publish (against the
   * value the producer hands in) and on consume (against the decoded value
   * before the handler runs). Failures throw at the boundary so a malformed
   * message never reaches the handler with the wrong type.
   */
  schema: TPayload;
  /**
   * Optional partition key. When the transport supports keyed delivery
   * (Kafka partitions, Redis Streams consumer assignment), the key schema's
   * value is JSON-stringified into the transport key. Transports without a
   * key concept (NATS Core) ignore this.
   */
  key?: TKey;
  /**
   * Optional human-readable description — surfaced by `xenosis graph`,
   * the dev dashboard, and the MCP server's event introspection.
   */
  description?: string;
}

export type EventTopicMap = Record<string, EventTopicSpec>;

export interface EventApi<T extends EventTopicMap = EventTopicMap> {
  /** Binding name — also the cradle key suffix (`events.<name>`). */
  name: string;
  /** Map of topic specs keyed by a stable JS identifier. */
  topics: T;
  /**
   * Default transport hint — `'kafka' | 'redpanda' | 'nats' | 'redis-streams' |
   * 'memory'` or any registered third-party transport name. Overridable per
   * binding in `xenosis.config.json`.
   */
  transport?: string;
  /** Optional API-level description for tooling. */
  description?: string;
}

// ─── User-facing producer types ─────────────────────────────────────────────

/** The publish() shape for a single topic. */
export type EventPublishFn<TSpec extends EventTopicSpec> = TSpec['key'] extends ZodTypeAny
  ? (
      key: z.input<NonNullable<TSpec['key']>>,
      payload: z.input<TSpec['schema']>,
      opts?: PublishOptions,
    ) => Promise<void>
  : (
      payload: z.input<TSpec['schema']>,
      opts?: PublishOptions,
    ) => Promise<void>;

export interface PublishOptions {
  /** Extra headers to attach to the message (trace headers are added automatically). */
  headers?: Record<string, string>;
  /** Suggested partition number — transport may ignore. */
  partition?: number;
}

/**
 * Producer-side bus for a single event API binding. `events.<name>` cradle
 * key resolves to this object; per-topic accessors carry typed publish().
 */
export type EventBus<TApi extends EventApi> = {
  readonly [K in keyof TApi['topics']]: {
    publish: EventPublishFn<TApi['topics'][K]>;
  };
};

// ─── User-facing consumer types ─────────────────────────────────────────────

/**
 * Context handed to an event handler — analogous to `XReq.XRequestContext`
 * on the HTTP side. Trace context propagates across services through message
 * headers so a published-event-then-consumed chain shows up as one trace.
 */
export interface EventContext {
  /** Stable consumer-side message id (transport-specific format). */
  messageId: string;
  /** The wire topic the message came from. */
  topic: string;
  /** Decoded key, if the transport delivered one. */
  key: unknown;
  /** Raw headers from the transport. */
  headers: Record<string, string>;
  /** Trace context, populated from x-xenosis-trace-* headers when present. */
  traceContext: TraceContext;
  /** Child logger bound to {traceId, topic, messageId}. */
  logger: ILogger;
  /** Per-message awilix scope (mirrors the per-request HTTP scope). */
  scope: AwilixContainer;
  /** Transport-specific partition / offset / sequence. */
  partition: number | undefined;
  offset: string | undefined;
  timestamp: number | undefined;
}

export type EventHandlerFn<TSpec extends EventTopicSpec> = (
  payload: z.output<TSpec['schema']>,
  ctx: EventContext,
) => Promise<void> | void;

/**
 * Default export shape for `src/events/<Name>.event.ts` files. The autoload
 * loader imports the file, reads `.topic` to know which topic to subscribe,
 * and calls `.handle` for each decoded message.
 */
export interface BoundEventHandler<TSpec extends EventTopicSpec = EventTopicSpec> {
  /** Marker so the loader can recognise a handler built by `defineEventHandler`. */
  readonly __xenosisEventHandler: true;
  /** Reference back to the topic spec from the event API package. */
  readonly topic: TSpec;
  /** API binding name this handler belongs to — derived from the importing file's location. */
  readonly apiName?: string;
  /** The user handler. */
  readonly handle: EventHandlerFn<TSpec>;
}
