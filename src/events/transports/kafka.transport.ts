import { createRequire } from 'node:module';
import type { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
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
 * Kafka adapter using `kafkajs`. Each event binding gets its own producer /
 * consumer pair so consumer group semantics don't bleed across bindings — a
 * service that publishes `billing-events` and consumes `audit-events` ends
 * up with two separate consumer clients on the same broker, each with the
 * binding's own groupId.
 *
 * Reads broker / sasl / ssl config from the binding's `transportOptions`
 * (or falls back to a referenced `connector` cradle entry).
 */
interface KafkaTransportConfig {
  brokers: string[];
  clientId?: string;
  ssl?: boolean;
  sasl?:
    | { mechanism: 'plain'; username: string; password: string }
    | { mechanism: 'scram-sha-256'; username: string; password: string }
    | { mechanism: 'scram-sha-512'; username: string; password: string };
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

function buildKafkaClient(cfg: KafkaTransportConfig, logger: ILogger): Kafka {
  if (!cfg.brokers || cfg.brokers.length === 0) {
    throw new Error('[xenosis/events] kafka transport: brokers list is empty');
  }
  const { Kafka } = require('kafkajs') as typeof import('kafkajs');
  return new Kafka({
    clientId: cfg.clientId ?? 'xenosis-events',
    brokers: cfg.brokers,
    ssl: cfg.ssl ?? false,
    ...(cfg.sasl ? { sasl: cfg.sasl } : {}),
    ...(cfg.connectionTimeoutMs !== undefined
      ? { connectionTimeout: cfg.connectionTimeoutMs }
      : {}),
    ...(cfg.requestTimeoutMs !== undefined ? { requestTimeout: cfg.requestTimeoutMs } : {}),
    logCreator: () => () => {
      // kafkajs has its own pino-style logger; we mute it since we relay
      // relevant events through the xenosis logger ourselves.
    },
  });
}

function decodeHeaders(
  raw: EachMessagePayload['message']['headers'],
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? v : Buffer.from(v as Buffer).toString('utf8');
  }
  return out;
}

class KafkaProducer implements EventTransportProducer {
  constructor(
    private readonly producer: Producer,
    private readonly logger: ILogger,
  ) {}

  async publish(msg: PublishMessage): Promise<void> {
    await this.producer.send({
      topic: msg.topic,
      messages: [
        {
          value: msg.value,
          ...(msg.key !== undefined ? { key: msg.key as never } : {}),
          ...(msg.headers ? { headers: msg.headers } : {}),
          ...(msg.partition !== undefined ? { partition: msg.partition } : {}),
        },
      ],
    });
  }

  async publishBatch(msgs: PublishMessage[]): Promise<void> {
    // Group by topic — kafkajs `send` takes one topic; `sendBatch` lets us
    // hit many at once with one network roundtrip.
    const byTopic = new Map<string, PublishMessage[]>();
    for (const m of msgs) {
      const arr = byTopic.get(m.topic) ?? [];
      arr.push(m);
      byTopic.set(m.topic, arr);
    }
    await this.producer.sendBatch({
      topicMessages: Array.from(byTopic.entries()).map(([topic, list]) => ({
        topic,
        messages: list.map((m) => ({
          value: m.value,
          ...(m.key !== undefined ? { key: m.key as never } : {}),
          ...(m.headers ? { headers: m.headers } : {}),
          ...(m.partition !== undefined ? { partition: m.partition } : {}),
        })),
      })),
    });
  }

  async flush(): Promise<void> {
    // kafkajs producer.send() awaits broker ack — no explicit flush needed.
  }

  async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'kafka producer disconnect error',
      );
    }
  }
}

class KafkaConsumer implements EventTransportConsumer {
  private readonly consumer: Consumer;
  private readonly logger: ILogger;

  constructor(consumer: Consumer, logger: ILogger) {
    this.consumer = consumer;
    this.logger = logger;
  }

  async subscribe(
    opts: SubscribeOptions,
    onMessage: (msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    for (const topic of opts.topics) {
      await this.consumer.subscribe({
        topic,
        fromBeginning: opts.fromBeginning ?? false,
      });
    }

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const consumeMsg: ConsumeMessage = {
          topic,
          value: message.value ?? Buffer.alloc(0),
          key: message.key ?? undefined,
          headers: decodeHeaders(message.headers),
          messageId: `${topic}-${partition}-${message.offset}`,
          partition,
          offset: message.offset,
          timestamp: message.timestamp ? Number(message.timestamp) : undefined,
          ack: async () => {
            // kafkajs auto-commits at the configured interval; manual ack is
            // a no-op here. The loader still calls it for transport-uniformity.
          },
          nack: async (err) => {
            // No native nack — re-throw so kafkajs surfaces it to the loader.
            // The loader logs and decides retry / DLQ policy.
            throw err;
          },
        };
        await onMessage(consumeMsg);
      },
    });
  }

  async pause(topics?: string[]): Promise<void> {
    this.consumer.pause(
      (topics ?? []).map((topic) => ({ topic })),
    );
  }

  async resume(topics?: string[]): Promise<void> {
    this.consumer.resume(
      (topics ?? []).map((topic) => ({ topic })),
    );
  }

  async disconnect(): Promise<void> {
    try {
      await this.consumer.disconnect();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'kafka consumer disconnect error',
      );
    }
  }
}

export const kafkaTransport: EventTransportProvider = {
  name: 'kafka',

  async createProducer(rawConfig, { logger }) {
    const cfg = rawConfig as KafkaTransportConfig;
    const kafka = buildKafkaClient(cfg, logger);
    const producer = kafka.producer();
    await producer.connect();
    logger.info({ brokers: cfg.brokers }, '[xenosis/events] kafka producer connected');
    return new KafkaProducer(producer, logger);
  },

  async createConsumer(rawConfig, { logger }) {
    const cfg = rawConfig as KafkaTransportConfig & { groupId: string };
    if (!cfg.groupId) {
      throw new Error(
        '[xenosis/events] kafka transport: consumer groupId is required',
      );
    }
    const kafka = buildKafkaClient(cfg, logger);
    const consumer = kafka.consumer({ groupId: cfg.groupId });
    await consumer.connect();
    logger.info(
      { brokers: cfg.brokers, groupId: cfg.groupId },
      '[xenosis/events] kafka consumer connected',
    );
    return new KafkaConsumer(consumer, logger);
  },
};
