import type { ILogger } from '../../types.js';
import type {
  ConsumeMessage,
  EventTransportConsumer,
  EventTransportProducer,
  EventTransportProvider,
  PublishMessage,
  SubscribeOptions,
} from './types.js';

/**
 * In-process pub/sub for tests, `xenosis dev` without external infra, and
 * single-binary deployments. Producer published messages go into a per-topic
 * queue that consumers (sharing the same `globalBus`) drain through their
 * subscribe callback.
 *
 * Crucially this lives in a MODULE-LEVEL singleton so a producer in one
 * cradle scope and a consumer in another (same process) actually see each
 * other — the loader can wire any number of bindings against `memory` and
 * they all share the bus.
 *
 * Not suitable for multi-process — for cross-service local dev, use Kafka,
 * NATS, or Redis Streams in Docker.
 */

interface InMemoryMessage extends ConsumeMessage {
  // Internal nack handling — we redeliver after a backoff.
}

interface TopicState {
  /** Active consumers (groupId → fn[]). Within a group, messages round-robin. */
  groups: Map<string, Array<(msg: InMemoryMessage) => Promise<void>>>;
  /** Round-robin pointer per group. */
  cursors: Map<string, number>;
  /** Backlog for fromBeginning consumers that connect later. */
  history: InMemoryMessage[];
  /** Sequence counter for messageId generation. */
  seq: number;
}

class InMemoryBus {
  private readonly topics = new Map<string, TopicState>();
  /** Cap history size to avoid unbounded memory growth in long-running dev. */
  private readonly historyMax = 1000;

  private state(topic: string): TopicState {
    let s = this.topics.get(topic);
    if (!s) {
      s = {
        groups: new Map(),
        cursors: new Map(),
        history: [],
        seq: 0,
      };
      this.topics.set(topic, s);
    }
    return s;
  }

  publish(msg: PublishMessage): void {
    const s = this.state(msg.topic);
    s.seq++;
    const cm: InMemoryMessage = {
      topic: msg.topic,
      value: msg.value,
      key: msg.key,
      headers: msg.headers ?? {},
      messageId: `mem-${msg.topic}-${s.seq}`,
      partition: msg.partition,
      offset: String(s.seq),
      timestamp: Date.now(),
      ack: async () => {
        // In-memory has no commit log; ack is a no-op.
      },
      nack: async () => {
        // Re-enqueue at the head of the next round, after a short delay.
        setTimeout(() => this.deliver(cm), 100);
      },
    };

    // Trim history.
    s.history.push(cm);
    if (s.history.length > this.historyMax) s.history.shift();

    this.deliver(cm);
  }

  private deliver(msg: InMemoryMessage): void {
    const s = this.state(msg.topic);
    // Each consumer group gets one copy of the message; within a group it
    // round-robins across consumers (cooperative consumption like Kafka).
    for (const [groupId, consumers] of s.groups.entries()) {
      if (consumers.length === 0) continue;
      const idx = s.cursors.get(groupId) ?? 0;
      const consumer = consumers[idx % consumers.length]!;
      s.cursors.set(groupId, idx + 1);
      // Fire-and-forget — errors are logged by the loader's handler wrapper.
      consumer(msg).catch(() => {
        // already handled upstream
      });
    }
  }

  subscribe(
    topic: string,
    groupId: string,
    fromBeginning: boolean,
    onMessage: (msg: InMemoryMessage) => Promise<void>,
  ): () => void {
    const s = this.state(topic);
    let arr = s.groups.get(groupId);
    if (!arr) {
      arr = [];
      s.groups.set(groupId, arr);
    }
    arr.push(onMessage);

    if (fromBeginning) {
      // Replay history to this new consumer — fire-and-forget.
      for (const m of s.history) {
        onMessage(m).catch(() => {});
      }
    }

    return () => {
      const list = s.groups.get(groupId);
      if (!list) return;
      const i = list.indexOf(onMessage);
      if (i >= 0) list.splice(i, 1);
    };
  }
}

/** Module-level singleton — all bindings using `memory` transport share it. */
const globalBus = new InMemoryBus();

/** Test helper — exposed for unit tests that want to reset state between runs. */
export function __resetInMemoryBus(): void {
  // Re-creating the bus would orphan any live subscriptions. Instead, we
  // re-instantiate by accessing internals via `as never` cast — confined to
  // test usage so it's intentional.
  (globalBus as unknown as { topics: Map<string, unknown> }).topics.clear();
}

class InMemoryProducer implements EventTransportProducer {
  async publish(msg: PublishMessage): Promise<void> {
    globalBus.publish(msg);
  }

  async flush(): Promise<void> {
    // Nothing to flush — publish is synchronous.
  }

  async disconnect(): Promise<void> {
    // No connection to close.
  }
}

class InMemoryConsumer implements EventTransportConsumer {
  private readonly unsubs: Array<() => void> = [];

  async subscribe(
    opts: SubscribeOptions,
    onMessage: (msg: ConsumeMessage) => Promise<void>,
  ): Promise<void> {
    for (const topic of opts.topics) {
      const unsub = globalBus.subscribe(
        topic,
        opts.groupId,
        opts.fromBeginning ?? false,
        async (msg) => {
          await onMessage(msg);
        },
      );
      this.unsubs.push(unsub);
    }
  }

  async pause(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }

  async resume(): Promise<void> {
    // No-op — loader re-subscribes.
  }

  async disconnect(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }
}

export const inMemoryTransport: EventTransportProvider = {
  name: 'memory',

  async createProducer(_config, { logger }) {
    logger.info('[xenosis/events] in-memory producer ready');
    return new InMemoryProducer();
  },

  async createConsumer(_config, { logger }) {
    logger.info('[xenosis/events] in-memory consumer ready');
    return new InMemoryConsumer();
  },
};
