import { createRequire } from 'node:module';
import type { Kafka, Producer, Consumer } from 'kafkajs';
import { ILogger } from '../types';

// ESM-safe `require` so kafkajs is only loaded when this provider runs.
const require = createRequire(import.meta.url);

export interface KafkaConnection {
  /** The shared Kafka client. Use it to create extra producers / consumers
   *  beyond the auto-wired ones (e.g. transactional producer, second group). */
  kafka: Kafka;
  /** Pre-connected producer. Present when `connectors.kafka.mode` is
   *  `'producer'` or `'both'`. */
  producer?: Producer;
  /** Pre-connected consumer, joined to `consumer.groupId`. Present when
   *  `connectors.kafka.mode` is `'consumer'` or `'both'`. Caller must
   *  `subscribe({ topic })` then `run({ eachMessage })` themselves. */
  consumer?: Consumer;
}

interface KafkaConnectorConfig {
  /** Broker host:port list (Kafka or Redpanda — wire-compatible). */
  brokers: string[];
  /** Logical client identifier sent to the broker. Default: `config.name`. */
  clientId?: string;
  /** Which clients to wire up. Default: `'producer'`. */
  mode?: 'producer' | 'consumer' | 'both';
  /** Required when `mode` includes consumer. */
  consumer?: {
    groupId: string;
    sessionTimeoutMs?: number;
  };
  /** Producer tunables forwarded verbatim to `kafka.producer({...})`. */
  producer?: {
    allowAutoTopicCreation?: boolean;
    transactionalId?: string;
    idempotent?: boolean;
  };
  ssl?: boolean;
  sasl?:
    | { mechanism: 'plain'; username: string; password: string }
    | { mechanism: 'scram-sha-256'; username: string; password: string }
    | { mechanism: 'scram-sha-512'; username: string; password: string };
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const kafkaProvider = ({
  logger,
  config,
}: {
  logger: ILogger;
  config: any;
}): KafkaConnection => {
  const cfg = config?.connectors?.kafka as KafkaConnectorConfig | undefined;
  if (!cfg?.brokers || cfg.brokers.length === 0) {
    throw new Error('connectors.kafka.brokers is required (non-empty list)');
  }

  const mode = cfg.mode ?? 'producer';
  if ((mode === 'consumer' || mode === 'both') && !cfg.consumer?.groupId) {
    throw new Error(`connectors.kafka.consumer.groupId is required when mode="${mode}"`);
  }

  const { Kafka } = require('kafkajs') as typeof import('kafkajs');

  const kafka = new Kafka({
    clientId: cfg.clientId ?? config?.name ?? 'xenosis-service',
    brokers: cfg.brokers,
    ssl: cfg.ssl ?? false,
    ...(cfg.sasl ? { sasl: cfg.sasl } : {}),
    ...(cfg.connectionTimeoutMs !== undefined
      ? { connectionTimeout: cfg.connectionTimeoutMs }
      : {}),
    ...(cfg.requestTimeoutMs !== undefined ? { requestTimeout: cfg.requestTimeoutMs } : {}),
    // kafkajs writes to its own logger — silence it (we surface relevant events
    // through pino below).
    logCreator: () => () => {},
  });

  const connection: KafkaConnection = { kafka };

  if (mode === 'producer' || mode === 'both') {
    const producer = kafka.producer({
      ...(cfg.producer?.allowAutoTopicCreation !== undefined
        ? { allowAutoTopicCreation: cfg.producer.allowAutoTopicCreation }
        : {}),
      ...(cfg.producer?.transactionalId !== undefined
        ? { transactionalId: cfg.producer.transactionalId }
        : {}),
      ...(cfg.producer?.idempotent !== undefined
        ? { idempotent: cfg.producer.idempotent }
        : {}),
    });
    producer
      .connect()
      .then(() => logger.info({ brokers: cfg.brokers }, 'Kafka producer connected'))
      .catch((err) => {
        logger.error(err.message || 'Kafka producer connect failed');
        throw err;
      });
    connection.producer = producer;
  }

  if (mode === 'consumer' || mode === 'both') {
    const consumer = kafka.consumer({
      groupId: cfg.consumer!.groupId,
      ...(cfg.consumer!.sessionTimeoutMs !== undefined
        ? { sessionTimeout: cfg.consumer!.sessionTimeoutMs }
        : {}),
    });
    consumer
      .connect()
      .then(() =>
        logger.info(
          { brokers: cfg.brokers, groupId: cfg.consumer!.groupId },
          'Kafka consumer connected',
        ),
      )
      .catch((err) => {
        logger.error(err.message || 'Kafka consumer connect failed');
        throw err;
      });
    connection.consumer = consumer;
  }

  return connection;
};

export default kafkaProvider;
