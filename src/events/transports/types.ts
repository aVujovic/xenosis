import type { ILogger } from '../../types.js';

/**
 * Wire-level event transport contract — the minimum surface every adapter must
 * expose so the events loader (which knows zod schemas, trace propagation, and
 * autoload conventions but nothing about kafka / nats / redis specifics) can
 * publish and consume in a uniform way.
 *
 * Mirrors the `SocketTransport` split on the realtime side: the loader owns
 * everything *domain-level* (schema validation, scope, trace), the transport
 * owns the *wire* (connect, send a frame, receive a frame, close).
 *
 * Producers and consumers are deliberately separate so transports that need
 * different clients for each (Kafka does) compose cleanly, and transports
 * that don't (NATS) just create both from the same connection.
 */

/** Outbound message handed by the loader to the transport. */
export interface PublishMessage {
  /** Wire topic / subject / stream name. The loader uses the value from the
   *  event API spec; transports treat it as opaque. */
  topic: string;
  /** Already-encoded payload. The loader does the JSON encoding (or whichever
   *  encoder is configured); transports just move bytes. */
  value: Buffer;
  /** Optional encoded key for keyed delivery (Kafka partitions, Redis Streams
   *  consumer assignment). Transports without a key concept (NATS Core) ignore. */
  key?: Buffer | string;
  /** Headers attached to the message. Always include xenosis trace headers
   *  when the loader has a trace context; user headers from `PublishOptions`
   *  are merged in too. */
  headers?: Record<string, string>;
  /** Optional partition hint — Kafka may honour, others ignore. */
  partition?: number;
}

/** Inbound message produced by the transport, consumed by the loader. */
export interface ConsumeMessage {
  /** Wire topic the message came from. */
  topic: string;
  /** Raw payload bytes — the loader decodes (JSON.parse) and zod-validates. */
  value: Buffer;
  /** Raw key bytes, if any. */
  key: Buffer | string | undefined;
  /** All headers as strings (the transport decodes Buffers if it must). */
  headers: Record<string, string>;
  /** Stable id for this message — used as `EventContext.messageId`. Format is
   *  transport-specific (Kafka: `${topic}-${partition}-${offset}`; NATS: stream
   *  sequence; Redis Streams: stream id). */
  messageId: string;
  /** Partition / shard the message lives on. */
  partition: number | undefined;
  /** Opaque positional info — Kafka offset, NATS seq, Redis Streams id. */
  offset: string | undefined;
  /** Producer-side timestamp when known. */
  timestamp: number | undefined;
  /**
   * Acknowledge this message. The loader calls this AFTER the handler resolves
   * successfully. Transports with auto-commit (default kafkajs behaviour) make
   * this a no-op. Transports with manual ack (NATS JetStream, Redis Streams)
   * actually advance their consumer position here.
   */
  ack(): Promise<void>;
  /**
   * Negative acknowledge — the handler threw, the transport should redeliver
   * (or move to DLQ). Default implementation re-throws; transports that support
   * explicit nack (JetStream) wire it up.
   */
  nack(err: unknown): Promise<void>;
}

/** Producer half of an event transport. */
export interface EventTransportProducer {
  publish(msg: PublishMessage): Promise<void>;
  /** Optional batch path — transports that don't override get a default impl. */
  publishBatch?(msgs: PublishMessage[]): Promise<void>;
  /** Flush any buffered messages; called during graceful shutdown. */
  flush(): Promise<void>;
  /** Close the producer connection. Called during graceful shutdown. */
  disconnect(): Promise<void>;
}

/** Loader-side options when subscribing a consumer. */
export interface SubscribeOptions {
  /** Wire topics to subscribe to. Always non-empty when the loader calls. */
  topics: string[];
  /** Consumer group identifier. Transports that require it (Kafka) use it for
   *  cooperative consumption; transports without groups (NATS Core) ignore. */
  groupId: string;
  /** Read from earliest available offset on first connect. */
  fromBeginning?: boolean;
}

/** Consumer half of an event transport. */
export interface EventTransportConsumer {
  /**
   * Subscribe to topics and dispatch messages to `onMessage`. The loader's
   * `onMessage` always runs the message through schema validation + handler
   * resolution + ack — the transport just needs to deliver decoded bytes.
   * Returns once subscription is fully established (loader uses this to log
   * subscription state at boot).
   */
  subscribe(
    opts: SubscribeOptions,
    onMessage: (msg: ConsumeMessage) => Promise<void>,
  ): Promise<void>;
  /** Stop consuming temporarily without disconnecting. */
  pause(topics?: string[]): Promise<void>;
  /** Resume after pause. */
  resume(topics?: string[]): Promise<void>;
  /** Close the consumer connection. Called during graceful shutdown. */
  disconnect(): Promise<void>;
}

/**
 * Factory hooked into the loader. The loader resolves a transport by name —
 * built-in or dynamic-imported from an npm package — and asks it to create a
 * producer or consumer per binding.
 */
export interface EventTransportProvider {
  /** Stable transport identifier — matches `config.events.<binding>.transport`. */
  readonly name: string;
  /** Build a producer for one binding. */
  createProducer(
    config: unknown,
    deps: { logger: ILogger },
  ): Promise<EventTransportProducer>;
  /** Build a consumer for one binding. */
  createConsumer(
    config: unknown,
    deps: { logger: ILogger },
  ): Promise<EventTransportConsumer>;
}
