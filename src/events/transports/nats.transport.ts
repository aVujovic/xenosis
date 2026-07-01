import { createRequire } from 'node:module';
import type { ILogger } from '../../types.js';
import type {
  ConsumeMessage,
  EventTransportConsumer,
  EventTransportProducer,
  EventTransportProvider,
  PublishMessage,
  SubscribeOptions,
} from './types.js';

const require = createRequire(import.meta.url);

/**
 * NATS adapter — defaults to **JetStream** for durable, replayable streams
 * (the equivalent of a Kafka topic) rather than NATS Core, which is fire-and-
 * forget pub/sub. JetStream lets us preserve groupId semantics through durable
 * consumers and gives us a real ack model (so manual nack actually redelivers).
 *
 * Topics in the event API spec map 1:1 to NATS subjects.
 *
 * The `nats` npm package is loaded via dynamic require at boot so services on
 * Kafka / Redpanda don't pay the resolution cost.
 */
interface NatsTransportConfig {
  /** NATS server URLs, e.g. `['nats://localhost:4222']`. */
  servers: string | string[];
  /** Optional client identity. */
  name?: string;
  /** Auth — username/password OR token OR nkey/jwt — forwarded verbatim. */
  auth?: {
    user?: string;
    pass?: string;
    token?: string;
    nkey?: string;
    jwt?: string;
  };
  /** TLS options forwarded verbatim. */
  tls?: Record<string, unknown>;
  /**
   * Default stream name on the producer side. When the publisher's topic
   * doesn't have an existing JetStream stream binding, NATS will reject the
   * publish. Operators usually create streams upfront — this is here for
   * default-create on dev. Optional.
   */
  defaultStream?: string;
  /**
   * Override durable consumer name. Default uses the loader-provided groupId.
   */
  consumerName?: string;
}

async function buildNatsConnection(cfg: NatsTransportConfig, logger: ILogger) {
  const nats = require('nats') as typeof import('nats');
  const conn = await nats.connect({
    servers: cfg.servers,
    ...(cfg.name ? { name: cfg.name } : {}),
    ...(cfg.auth?.user ? { user: cfg.auth.user, pass: cfg.auth.pass } : {}),
    ...(cfg.auth?.token ? { token: cfg.auth.token } : {}),
    ...(cfg.tls ? { tls: cfg.tls as never } : {}),
  });
  logger.info(
    { servers: cfg.servers },
    '[xenosis/events] nats connection established',
  );
  return { nats, conn };
}

class NatsProducer implements EventTransportProducer {
  constructor(
    private readonly conn: import('nats').NatsConnection,
    private readonly logger: ILogger,
  ) {}

  async publish(msg: PublishMessage): Promise<void> {
    // Use JetStream for durability when stream is bound; falls back to Core
    // pub if JetStream rejects (e.g. no stream covers the subject yet).
    const js = this.conn.jetstream();
    try {
      await js.publish(msg.topic, msg.value, {
        ...(msg.headers ? { headers: buildNatsHeaders(msg.headers) } : {}),
      });
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, topic: msg.topic },
        '[xenosis/events] JetStream publish failed; falling back to Core pub',
      );
      this.conn.publish(msg.topic, msg.value, {
        ...(msg.headers ? { headers: buildNatsHeaders(msg.headers) } : {}),
      });
    }
  }

  async flush(): Promise<void> {
    await this.conn.flush();
  }

  async disconnect(): Promise<void> {
    try {
      await this.conn.drain();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'nats producer drain error',
      );
    }
  }
}

function buildNatsHeaders(headers: Record<string, string>) {
  const nats = require('nats') as typeof import('nats');
  const h = nats.headers();
  for (const [k, v] of Object.entries(headers)) {
    h.append(k, v);
  }
  return h;
}

function decodeNatsHeaders(
  h: import('nats').MsgHdrs | undefined,
): Record<string, string> {
  if (!h) return {};
  const out: Record<string, string> = {};
  for (const key of h.keys()) {
    const v = h.get(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

class NatsConsumer implements EventTransportConsumer {
  private subscriptions: Array<{ unsubscribe(): void }> = [];

  constructor(
    private readonly conn: import('nats').NatsConnection,
    private readonly cfg: NatsTransportConfig,
    private readonly logger: ILogger,
  ) {}

  async subscribe(
    opts: SubscribeOptions,
    onMessage: (msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    const js = this.conn.jetstream();
    const jsm = await this.conn.jetstreamManager();

    for (const topic of opts.topics) {
      // Ensure a durable consumer exists for (stream-covering-subject, groupId).
      const streamName = this.cfg.defaultStream ?? deriveStreamName(topic);
      const durable = this.cfg.consumerName ?? opts.groupId;

      try {
        await jsm.consumers.add(streamName, {
          durable_name: durable,
          filter_subject: topic,
          deliver_policy: opts.fromBeginning
            ? ({ deliver_policy: 'all' } as never)
            : ({ deliver_policy: 'new' } as never),
          ack_policy: 'explicit' as never,
        } as never);
      } catch (err) {
        // Already exists — fine. We assume operators manage stream + consumer
        // creation in production; this auto-create is a dev convenience.
        const msg = (err as Error).message ?? '';
        if (!msg.includes('consumer name already in use')) {
          this.logger.warn(
            { err: msg, topic, durable },
            '[xenosis/events] nats consumer add warning',
          );
        }
      }

      const consumer = await js.consumers.get(streamName, durable);
      const messages = await consumer.consume();

      // Background loop — yields messages until the subscription closes.
      (async () => {
        for await (const m of messages) {
          const consumeMsg: ConsumeMessage = {
            topic: m.subject,
            value: Buffer.from(m.data),
            key: undefined,
            headers: decodeNatsHeaders(m.headers),
            messageId: `${m.subject}-${m.seq}`,
            partition: undefined,
            offset: String(m.seq),
            timestamp: m.info?.timestampNanos
              ? Math.floor(Number(m.info.timestampNanos) / 1_000_000)
              : undefined,
            ack: async () => m.ack(),
            nack: async () => m.nak(),
          };
          try {
            await onMessage(consumeMsg);
          } catch (err) {
            this.logger.error(
              { err: (err as Error).message, topic: m.subject },
              '[xenosis/events] nats handler threw — nak',
            );
            m.nak();
          }
        }
      })().catch((err) => {
        this.logger.error(
          { err: (err as Error).message },
          '[xenosis/events] nats consume loop crashed',
        );
      });

      this.subscriptions.push({
        unsubscribe: () => messages.stop(),
      });
    }
  }

  async pause(): Promise<void> {
    // NATS JetStream doesn't have a pause primitive at the consumer level;
    // the closest is to stop consuming. We expose this as a best-effort.
    for (const s of this.subscriptions) s.unsubscribe();
    this.subscriptions = [];
  }

  async resume(): Promise<void> {
    // Resume would require re-subscribing; the loader handles this by calling
    // subscribe() again. No-op here.
  }

  async disconnect(): Promise<void> {
    for (const s of this.subscriptions) {
      try {
        s.unsubscribe();
      } catch {
        // ignore
      }
    }
    try {
      await this.conn.drain();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'nats consumer drain error',
      );
    }
  }
}

/**
 * Best-effort guess at the JetStream stream name covering a subject. NATS
 * operators usually name streams after the top-level subject segment
 * (`billing.*` → stream `billing`). When the convention doesn't apply, set
 * `transportOptions.defaultStream` on the binding.
 */
function deriveStreamName(subject: string): string {
  const head = subject.split('.')[0];
  return head ?? subject;
}

export const natsTransport: EventTransportProvider = {
  name: 'nats',

  async createProducer(rawConfig, { logger }) {
    const cfg = rawConfig as NatsTransportConfig;
    const { conn } = await buildNatsConnection(cfg, logger);
    return new NatsProducer(conn, logger);
  },

  async createConsumer(rawConfig, { logger }) {
    const cfg = rawConfig as NatsTransportConfig & { groupId: string };
    const { conn } = await buildNatsConnection(cfg, logger);
    return new NatsConsumer(conn, cfg, logger);
  },
};
