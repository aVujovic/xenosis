import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineEventApi } from './defineEventApi';
import { defineEventHandler } from './defineEventHandler';
import { inMemoryTransport, __resetInMemoryBus } from './transports/in-memory.transport';
import type { EventTransportProducer, EventTransportConsumer } from './transports/types';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as never;

describe('in-memory event transport', () => {
  it('delivers a published message to a subscribed handler', async () => {
    __resetInMemoryBus();

    const producer: EventTransportProducer = await inMemoryTransport.createProducer({}, { logger: noopLogger });
    const consumer: EventTransportConsumer = await inMemoryTransport.createConsumer(
      { groupId: 'test-group' },
      { logger: noopLogger },
    );

    const received: unknown[] = [];
    const done = new Promise<void>((resolve) => {
      void consumer.subscribe(
        { topics: ['t.demo'], groupId: 'test-group' },
        async (msg) => {
          received.push(JSON.parse(msg.value.toString('utf8')));
          await msg.ack();
          resolve();
        },
      );
    });

    await producer.publish({
      topic: 't.demo',
      value: Buffer.from(JSON.stringify({ hello: 'world' })),
    });

    await done;
    expect(received).toEqual([{ hello: 'world' }]);

    await consumer.disconnect();
    await producer.disconnect();
  });

  it('round-robins within a consumer group', async () => {
    __resetInMemoryBus();

    const producer = await inMemoryTransport.createProducer({}, { logger: noopLogger });
    const c1 = await inMemoryTransport.createConsumer({ groupId: 'g' }, { logger: noopLogger });
    const c2 = await inMemoryTransport.createConsumer({ groupId: 'g' }, { logger: noopLogger });

    const seen1: number[] = [];
    const seen2: number[] = [];

    await c1.subscribe(
      { topics: ['t.rr'], groupId: 'g' },
      async (msg) => {
        seen1.push(JSON.parse(msg.value.toString('utf8')).n);
        await msg.ack();
      },
    );
    await c2.subscribe(
      { topics: ['t.rr'], groupId: 'g' },
      async (msg) => {
        seen2.push(JSON.parse(msg.value.toString('utf8')).n);
        await msg.ack();
      },
    );

    for (let n = 0; n < 4; n++) {
      await producer.publish({
        topic: 't.rr',
        value: Buffer.from(JSON.stringify({ n })),
      });
    }

    // Let microtasks flush.
    await new Promise((r) => setTimeout(r, 50));

    // Two consumers within one group → each gets some, none gets all.
    expect(seen1.length + seen2.length).toBe(4);
    expect(seen1.length).toBeGreaterThan(0);
    expect(seen2.length).toBeGreaterThan(0);

    await c1.disconnect();
    await c2.disconnect();
    await producer.disconnect();
  });

  it('delivers to multiple groups (fan-out)', async () => {
    __resetInMemoryBus();

    const producer = await inMemoryTransport.createProducer({}, { logger: noopLogger });
    const cA = await inMemoryTransport.createConsumer({ groupId: 'A' }, { logger: noopLogger });
    const cB = await inMemoryTransport.createConsumer({ groupId: 'B' }, { logger: noopLogger });

    const seenA: number[] = [];
    const seenB: number[] = [];

    await cA.subscribe({ topics: ['t.fan'], groupId: 'A' }, async (m) => {
      seenA.push(JSON.parse(m.value.toString('utf8')).n);
      await m.ack();
    });
    await cB.subscribe({ topics: ['t.fan'], groupId: 'B' }, async (m) => {
      seenB.push(JSON.parse(m.value.toString('utf8')).n);
      await m.ack();
    });

    await producer.publish({ topic: 't.fan', value: Buffer.from(JSON.stringify({ n: 1 })) });
    await producer.publish({ topic: 't.fan', value: Buffer.from(JSON.stringify({ n: 2 })) });

    await new Promise((r) => setTimeout(r, 50));

    expect(seenA).toEqual([1, 2]);
    expect(seenB).toEqual([1, 2]);

    await cA.disconnect();
    await cB.disconnect();
    await producer.disconnect();
  });
});

describe('defineEventApi + defineEventHandler', () => {
  it('builds a frozen EventApi from a spec', () => {
    const api = defineEventApi({
      name: 'billing-events',
      topics: {
        chargeSucceeded: {
          topic: 'billing.charge.succeeded',
          schema: z.object({ chargeId: z.string(), amount: z.number() }),
        },
      },
    });

    expect(api.name).toBe('billing-events');
    expect(api.topics.chargeSucceeded.topic).toBe('billing.charge.succeeded');
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('throws when spec is missing name or topics', () => {
    // @ts-expect-error: deliberately invalid for runtime check
    expect(() => defineEventApi({ topics: {} })).toThrow(/name.*required/);
    // @ts-expect-error: deliberately invalid for runtime check
    expect(() => defineEventApi({ name: 'x' })).toThrow(/topics.*required/);
  });

  it('throws when a topic lacks wire topic or schema', () => {
    expect(() =>
      defineEventApi({
        name: 'x',
        topics: {
          // @ts-expect-error: missing topic
          bad: { schema: z.object({}) },
        },
      }),
    ).toThrow(/missing wire topic/);
  });

  it('defineEventHandler returns a bound handler with the marker', () => {
    const api = defineEventApi({
      name: 'x',
      topics: {
        ping: { topic: 't.ping', schema: z.object({ n: z.number() }) },
      },
    });

    const handler = defineEventHandler(api.topics.ping, async () => {});
    expect(handler.__xenosisEventHandler).toBe(true);
    expect(handler.topic).toBe(api.topics.ping);
    expect(typeof handler.handle).toBe('function');
  });

  it('defineEventHandler throws on non-topic-spec first arg', () => {
    // @ts-expect-error: deliberately invalid
    expect(() => defineEventHandler('not-a-topic', async () => {})).toThrow(/topic spec/);
  });
});
