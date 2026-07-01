import { defineEventApi, z } from '@xenosisorg/xenosis-core';

/**
 * Async event contract owned by billing-service. Any service that needs to
 * react to billing lifecycle events imports this package and registers a
 * `defineEventHandler(billingEvents.topics.<name>, ...)` under `src/events/`.
 *
 * The wire topics use a dotted namespace (`billing.charge.succeeded`) so a
 * Kafka / Redpanda broker can group them under a shared prefix and so a NATS
 * cluster can route them with a stream binding on `billing.*`.
 */
export default defineEventApi({
  name: 'billing-events',
  transport: 'kafka',
  description: 'Lifecycle events emitted by billing-service.',
  topics: {
    chargeSucceeded: {
      topic: 'billing.charge.succeeded',
      description: 'A charge has been authorised and captured.',
      key: z.object({ userId: z.string() }),
      schema: z.object({
        chargeId: z.string(),
        userId: z.string(),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
      }),
    },
    chargeRefunded: {
      topic: 'billing.charge.refunded',
      description: 'A previously-captured charge has been refunded.',
      key: z.object({ userId: z.string() }),
      schema: z.object({
        chargeId: z.string(),
        userId: z.string(),
        reason: z.string().optional(),
      }),
    },
  },
});
