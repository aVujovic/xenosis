import type {
  BoundEventHandler,
  EventHandlerFn,
  EventTopicSpec,
} from './types.js';

/**
 * Build a typed consumer-side handler for one topic from an event API. Used
 * as the default export of `src/events/<Name>.event.ts` files; autoload
 * picks them up and subscribes the underlying transport on boot.
 *
 *   // notifications-service/src/events/ChargeSucceeded.event.ts
 *   import billingEvents from '@example/billing-events';
 *   import { defineEventHandler } from '@xenosisorg/xenosis-core';
 *
 *   export default defineEventHandler(
 *     billingEvents.topics.chargeSucceeded,
 *     async (payload, ctx) => {
 *       ctx.logger.info({ chargeId: payload.chargeId }, 'charge.succeeded received');
 *       await ctx.scope.cradle.emailService.send(payload.userId, 'charge-receipt');
 *     },
 *   );
 *
 * The handler receives the zod-validated payload (so the schema's
 * `z.output<>` is what your code sees) and an `EventContext` with the
 * per-message scope, trace context, and child logger.
 */
export function defineEventHandler<TSpec extends EventTopicSpec>(
  topic: TSpec,
  handle: EventHandlerFn<TSpec>,
): BoundEventHandler<TSpec> {
  if (!topic || typeof topic !== 'object' || !('topic' in topic)) {
    throw new Error(
      '[xenosis/events] defineEventHandler: first argument must be a topic spec from a defineEventApi(...) package.',
    );
  }
  if (typeof handle !== 'function') {
    throw new Error('[xenosis/events] defineEventHandler: handler must be a function.');
  }
  return {
    __xenosisEventHandler: true,
    topic,
    handle,
  };
}
