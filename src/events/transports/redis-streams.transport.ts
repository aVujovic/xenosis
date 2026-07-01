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
 * Redis Streams adapter — uses XADD to publish and XREADGROUP for cooperative
 * consumption. Suitable for workspaces already running Redis that want a
 * lighter alternative to Kafka for moderate event volume.
 *
 * Topic in the event API spec maps 1:1 to a Redis Stream key.
 *
 * Headers are stored as additional `XADD` fields prefixed with `h:` (so the
 * payload field `value` and headers `h:trace-id`, etc. coexist on the same
 * stream entry without name collisions).
 */
interface RedisStreamsTransportConfig {
  /** Redis host (default 'localhost'). */
  host?: string;
  /** Redis port (default 6379). */
  port?: number;
  /** Auth — username (Redis 6+) and password. */
  username?: string;
  password?: string;
  /** Database index. */
  db?: number;
  /** TLS support. */
  tls?: Record<string, unknown>;
  /**
   * Consumer-side: identifies this instance within the consumer group. Default
   * `${groupId}-${pid}` — gives N replicas of the same service distinct names
   * so PEL accounting works. Override for stable rolling deploys.
   */
  consumerName?: string;
  /**
   * Consumer-side: how long to block on XREADGROUP. Default 5000ms. Shorter
   * means more responsive shutdown; longer means fewer empty reads.
   */
  blockMs?: number;
  /**
   * Consumer-side: maximum entries to fetch per XREADGROUP call. Default 10.
   */
  count?: number;
}

const HEADER_PREFIX = 'h:';
const VALUE_FIELD = 'v';
const KEY_FIELD = 'k';

function buildRedisClient(cfg: RedisStreamsTransportConfig, logger: ILogger) {
  const Redis = require('ioredis') as typeof import('ioredis');
  // ioredis v5 default export is the class.
  const client = new (Redis as unknown as { default: typeof Redis.default }).default({
    host: cfg.host ?? 'localhost',
    port: cfg.port ?? 6379,
    ...(cfg.username ? { username: cfg.username } : {}),
    ...(cfg.password ? { password: cfg.password } : {}),
    ...(cfg.db !== undefined ? { db: cfg.db } : {}),
    ...(cfg.tls ? { tls: cfg.tls as never } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: null, // streams blocking commands need this
  });
  client.on('error', (err) => {
    logger.warn({ err: err.message }, '[xenosis/events] redis-streams error');
  });
  return client;
}

class RedisStreamsProducer implements EventTransportProducer {
  constructor(
    private readonly client: import('ioredis').default,
    private readonly logger: ILogger,
  ) {}

  async publish(msg: PublishMessage): Promise<void> {
    const args: (string | Buffer)[] = [VALUE_FIELD, msg.value];
    if (msg.key !== undefined) {
      args.push(KEY_FIELD, msg.key);
    }
    if (msg.headers) {
      for (const [k, v] of Object.entries(msg.headers)) {
        args.push(`${HEADER_PREFIX}${k}`, v);
      }
    }
    await (this.client as never as {
      xadd: (key: string, id: string, ...args: (string | Buffer)[]) => Promise<string>;
    }).xadd(msg.topic, '*', ...args);
  }

  async flush(): Promise<void> {
    // ioredis sends commands eagerly — nothing to flush.
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'redis-streams producer disconnect error',
      );
    }
  }
}

class RedisStreamsConsumer implements EventTransportConsumer {
  private readonly stopFlags = new Map<string, { stop: boolean }>();
  private readonly consumerName: string;
  private readonly blockMs: number;
  private readonly count: number;

  constructor(
    private readonly client: import('ioredis').default,
    cfg: RedisStreamsTransportConfig & { groupId: string },
    private readonly logger: ILogger,
  ) {
    this.consumerName = cfg.consumerName ?? `${cfg.groupId}-${process.pid}`;
    this.blockMs = cfg.blockMs ?? 5000;
    this.count = cfg.count ?? 10;
  }

  async subscribe(
    opts: SubscribeOptions,
    onMessage: (msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    const groupId = opts.groupId;
    const startId = opts.fromBeginning ? '0' : '$';

    for (const topic of opts.topics) {
      // XGROUP CREATE — auto-create the group if it doesn't exist. We tolerate
      // BUSYGROUP (already exists) silently.
      try {
        await this.client.xgroup('CREATE', topic, groupId, startId, 'MKSTREAM');
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!msg.includes('BUSYGROUP')) {
          this.logger.warn(
            { err: msg, topic, groupId },
            '[xenosis/events] redis-streams XGROUP CREATE warning',
          );
        }
      }

      const flag = { stop: false };
      this.stopFlags.set(topic, flag);

      // Background polling loop per topic.
      (async () => {
        while (!flag.stop) {
          let entries: Array<
            [string, Array<[string, string[]]>]
          > | null = null;

          try {
            entries = (await (this.client as never as {
              xreadgroup: (...args: unknown[]) => Promise<unknown>;
            }).xreadgroup(
              'GROUP',
              groupId,
              this.consumerName,
              'COUNT',
              this.count,
              'BLOCK',
              this.blockMs,
              'STREAMS',
              topic,
              '>',
            )) as Array<[string, Array<[string, string[]]>]> | null;
          } catch (err) {
            this.logger.error(
              { err: (err as Error).message, topic },
              '[xenosis/events] redis-streams XREADGROUP error — backing off 1s',
            );
            await sleep(1000);
            continue;
          }

          if (!entries) continue;

          for (const [streamKey, streamEntries] of entries) {
            for (const [id, fields] of streamEntries) {
              const parsed = parseEntry(fields);
              const consumeMsg: ConsumeMessage = {
                topic: streamKey,
                value: parsed.value,
                key: parsed.key,
                headers: parsed.headers,
                messageId: id,
                partition: undefined,
                offset: id,
                timestamp: parseStreamIdTimestamp(id),
                ack: async () => {
                  await this.client.xack(streamKey, groupId, id);
                },
                nack: async () => {
                  // Leave the entry in the Pending Entries List; on next
                  // claim cycle it gets redelivered. No explicit nack.
                },
              };

              try {
                await onMessage(consumeMsg);
              } catch (err) {
                this.logger.error(
                  { err: (err as Error).message, topic: streamKey, id },
                  '[xenosis/events] redis-streams handler threw — entry stays in PEL',
                );
              }
            }
          }
        }
      })().catch((err) => {
        this.logger.error(
          { err: (err as Error).message, topic },
          '[xenosis/events] redis-streams consume loop crashed',
        );
      });
    }
  }

  async pause(): Promise<void> {
    for (const flag of this.stopFlags.values()) flag.stop = true;
  }

  async resume(): Promise<void> {
    // Resume would need re-subscribing. The loader handles this by calling
    // subscribe() again. No-op here.
  }

  async disconnect(): Promise<void> {
    for (const flag of this.stopFlags.values()) flag.stop = true;
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'redis-streams consumer disconnect error',
      );
    }
  }
}

function parseEntry(fields: string[]): {
  value: Buffer;
  key: string | undefined;
  headers: Record<string, string>;
} {
  let value: Buffer = Buffer.alloc(0);
  let key: string | undefined;
  const headers: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const name = fields[i]!;
    const v = fields[i + 1] ?? '';
    if (name === VALUE_FIELD) {
      value = Buffer.from(v);
    } else if (name === KEY_FIELD) {
      key = v;
    } else if (name.startsWith(HEADER_PREFIX)) {
      headers[name.slice(HEADER_PREFIX.length)] = v;
    }
  }
  return { value, key, headers };
}

/** Stream IDs are `<ms>-<seq>` — extract the ms part as timestamp. */
function parseStreamIdTimestamp(id: string): number | undefined {
  const dashIdx = id.indexOf('-');
  const msPart = dashIdx === -1 ? id : id.slice(0, dashIdx);
  const n = Number(msPart);
  return Number.isFinite(n) ? n : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const redisStreamsTransport: EventTransportProvider = {
  name: 'redis-streams',

  async createProducer(rawConfig, { logger }) {
    const cfg = rawConfig as RedisStreamsTransportConfig;
    const client = buildRedisClient(cfg, logger);
    await client.connect();
    logger.info(
      { host: cfg.host ?? 'localhost', port: cfg.port ?? 6379 },
      '[xenosis/events] redis-streams producer connected',
    );
    return new RedisStreamsProducer(client, logger);
  },

  async createConsumer(rawConfig, { logger }) {
    const cfg = rawConfig as RedisStreamsTransportConfig & { groupId: string };
    if (!cfg.groupId) {
      throw new Error(
        '[xenosis/events] redis-streams transport: consumer groupId is required',
      );
    }
    const client = buildRedisClient(cfg, logger);
    await client.connect();
    logger.info(
      { host: cfg.host ?? 'localhost', port: cfg.port ?? 6379, groupId: cfg.groupId },
      '[xenosis/events] redis-streams consumer connected',
    );
    return new RedisStreamsConsumer(client, cfg, logger);
  },
};
