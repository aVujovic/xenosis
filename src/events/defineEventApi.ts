import type { EventApi, EventTopicMap } from './types.js';

/**
 * Declare an event API contract — the async counterpart to `definePeerApi`
 * (HTTP RPC) and `defineSocketApi` (WebSockets). Intended to live in a shared
 * npm package (`apis/<name>-events/src/index.ts`) so the topic names and
 * payload schemas are the single source of truth between every producer and
 * every consumer.
 *
 *   import { defineEventApi, z } from '@xenosisorg/xenosis-core';
 *
 *   export default defineEventApi({
 *     name: 'billing-events',
 *     transport: 'kafka',
 *     topics: {
 *       chargeSucceeded: {
 *         topic: 'billing.charge.succeeded',
 *         key:    z.object({ userId: z.string() }),
 *         schema: z.object({
 *           chargeId: z.string(),
 *           userId:   z.string(),
 *           amount:   z.number(),
 *           currency: z.string(),
 *         }),
 *       },
 *     },
 *   });
 *
 * The runtime is purely declarative — no side effects, no transport calls.
 * Producer and consumer wiring happens in the events loader at boot.
 */
export function defineEventApi<T extends EventTopicMap>(
  spec: EventApi<T>,
): EventApi<T> {
  if (!spec.name) {
    throw new Error('[xenosis/events] defineEventApi: `name` is required.');
  }
  if (!spec.topics || typeof spec.topics !== 'object') {
    throw new Error(
      '[xenosis/events] defineEventApi: `topics` is required (use an empty object {} if none).',
    );
  }
  for (const [k, t] of Object.entries(spec.topics)) {
    if (!t.topic) {
      throw new Error(
        `[xenosis/events] defineEventApi(${spec.name}): topic "${k}" missing wire topic name.`,
      );
    }
    if (!t.schema) {
      throw new Error(
        `[xenosis/events] defineEventApi(${spec.name}): topic "${k}" missing zod schema.`,
      );
    }
  }
  return Object.freeze(spec);
}
