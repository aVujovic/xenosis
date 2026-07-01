import { describe, it, expect } from 'vitest';
import {
  buildEventGraph,
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

describe('buildEventGraph', () => {
  it('connects a producer service to a consumer service via shared api', () => {
    const services: EventServiceNode[] = [
      {
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
      },
      {
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
      },
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
      {
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
      },
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
      {
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
      },
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
      {
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
      },
    ];
    const graph = buildEventGraph(services, new Map());
    expect(graph.apis).toEqual([]);
  });
});
