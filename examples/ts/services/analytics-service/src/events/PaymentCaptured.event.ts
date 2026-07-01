import { defineEventHandler } from '@xenosisorg/xenosis-core';
import paymentsEvents from '@example/payments-events';

export default defineEventHandler(
  paymentsEvents.topics.paymentCaptured,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId, amount: payload.amount, currency: payload.currency },
      '📊 analytics:payment.captured (revenue recognised)',
    );
  },
);
