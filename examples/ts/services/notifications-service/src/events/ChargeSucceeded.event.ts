import { defineEventHandler } from '@xenosisorg/xenosis-core';
import billingEvents from '@example/billing-events';

/**
 * Send a receipt when billing-service publishes `billing.charge.succeeded`.
 * Imported by autoload at boot; no manual wiring needed beyond declaring
 * `events.billing` with `mode: "consumer"` in xenosis.config.json.
 */
export default defineEventHandler(
  billingEvents.topics.chargeSucceeded,
  async (payload, ctx) => {
    ctx.logger.info(
      { chargeId: payload.chargeId, userId: payload.userId },
      'charge.succeeded — sending receipt',
    );
    // In a real service: ctx.scope.cradle.emailService.send(...)
  },
);
