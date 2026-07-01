import { defineEventHandler } from '@xenosisorg/xenosis-core';
import paymentsEvents from '@example/payments-events';

export default defineEventHandler(
  paymentsEvents.topics.paymentFailed,
  async (payload, ctx) => {
    ctx.logger.warn(
      { orderId: payload.orderId, reason: payload.reason },
      '📧 [email:payment-failed] "Payment could not be processed"',
    );
  },
);
