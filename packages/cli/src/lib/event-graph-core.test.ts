import { describe, it, expect } from 'vitest';
import {
  buildEventGraph,
  type EventBinding,
  type EventServiceNode,
  type RawEventApi,
} from './event-graph-core';

const billingApi: RawEventApi = {
  name: 'billing-events',
  transport: 'kafka',
  topics: {
    chargeSucceeded: { topic: 'billing.charge.succeeded' },
    chargeRefunded: { topic: 'billing.charge.refunded' },
  },
};

/** Fill in the mandatory publishes/consumes/... fields test literals omit. */
function mkBinding(partial: Omit<EventBinding, 'publishes' | 'consumes'> & Partial<Pick<EventBinding, 'publishes' | 'consumes'>>): EventBinding {
  return {
    publishes: partial.publishes ?? [],
    consumes: partial.consumes ?? [],
    ...partial,
  };
}

function mkService(partial: {
  name: string;
  bindings: Array<Omit<EventBinding, 'publishes' | 'consumes'> & Partial<Pick<EventBinding, 'publishes' | 'consumes'>>>;
  handlersByBinding: Record<string, string[]>;
  publishesByBinding?: Record<string, string[]>;
}): EventServiceNode {
  return {
    name: partial.name,
    configPath: `/fake/${partial.name}/xenosis.config.json`,
    bindings: partial.bindings.map(mkBinding),
    handlersByBinding: partial.handlersByBinding,
    publishesByBinding: partial.publishesByBinding ?? {},
  };
}

describe('buildEventGraph', () => {
  it('connects a producer service to a consumer service via shared api', () => {
    const services: EventServiceNode[] = [
      mkService({
        name: 'billing-service',
        bindings: [
          {
            binding: 'billing',
            package: '@example/billing-events',
            transport: 'kafka',
            mode: 'producer',
            groupId: 'billing-service-billing',
          },
        ],
        handlersByBinding: { billing: [] },
      }),
      mkService({
        name: 'notifications-service',
        bindings: [
          {
            binding: 'billing',
            package: '@example/billing-events',
            transport: 'kafka',
            mode: 'consumer',
            groupId: 'notifications-billing',
          },
        ],
        handlersByBinding: { billing: ['chargeSucceeded'] },
      }),
    ];

    const graph = buildEventGraph(
      services,
      new Map([['@example/billing-events', billingApi]]),
    );

    expect(graph.apis).toHaveLength(1);
    const api = graph.apis[0]!;
    expect(api.name).toBe('billing-events');
    expect(api.producers).toEqual(['billing-service']);
    expect(api.producersByTopic.chargeSucceeded).toEqual(['billing-service']);
    expect(api.consumersByTopic.chargeSucceeded).toEqual(['notifications-service']);
    // No consumer for chargeRefunded → orphan.
    expect(graph.orphans).toEqual([
      { apiName: 'billing-events', topicKey: 'chargeRefunded', topic: 'billing.charge.refunded' },
    ]);
    expect(graph.unservedConsumers).toEqual([]);
  });

  it('flags an unserved consumer when no service produces a topic', () => {
    const services: EventServiceNode[] = [
      mkService({
        name: 'notifications-service',
        bindings: [
          {
            binding: 'billing',
            package: '@example/billing-events',
            transport: 'kafka',
            mode: 'consumer',
            groupId: 'notifications-billing',
          },
        ],
        handlersByBinding: { billing: ['chargeSucceeded'] },
      }),
    ];

    const graph = buildEventGraph(
      services,
      new Map([['@example/billing-events', billingApi]]),
    );

    expect(graph.unservedConsumers).toEqual([
      {
        apiName: 'billing-events',
        topicKey: 'chargeSucceeded',
        topic: 'billing.charge.succeeded',
        service: 'notifications-service',
      },
    ]);
  });

  it('mode "both" marks the service as both producer and consumer', () => {
    const services: EventServiceNode[] = [
      mkService({
        name: 'orchestrator',
        bindings: [
          {
            binding: 'billing',
            package: '@example/billing-events',
            transport: 'memory',
            mode: 'both',
            groupId: 'orchestrator-billing',
          },
        ],
        handlersByBinding: { billing: ['chargeSucceeded'] },
      }),
    ];
    const graph = buildEventGraph(
      services,
      new Map([['@example/billing-events', billingApi]]),
    );
    const api = graph.apis[0]!;
    expect(api.producers).toEqual(['orchestrator']);
    expect(api.consumersByTopic.chargeSucceeded).toEqual(['orchestrator']);
  });

  it('skips bindings whose api package failed to parse', () => {
    const services: EventServiceNode[] = [
      mkService({
        name: 's',
        bindings: [
          {
            binding: 'x',
            package: '@example/missing',
            transport: 'memory',
            mode: 'producer',
            groupId: 's-x',
          },
        ],
        handlersByBinding: { x: [] },
      }),
    ];
    const graph = buildEventGraph(services, new Map());
    expect(graph.apis).toEqual([]);
  });
});
