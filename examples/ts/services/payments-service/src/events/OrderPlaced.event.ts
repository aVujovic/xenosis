import { defineEventHandler } from '@xenosisorg/xenosis-core';
import type { EventBus } from '@xenosisorg/xenosis-core';
import ordersEvents from '@example/orders-events';
import type paymentsEvents from '@example/payments-events';
import { randomUUID } from 'node:crypto';

/**
 * order.placed → simulate a charge attempt. 90% success rate so the demo
 * exercises both the paymentCaptured → orderConfirmed and paymentFailed →
 * orderCancelled paths as you post more orders.
 */
export default defineEventHandler(
  ordersEvents.topics.orderPlaced,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId, amount: payload.totalAmount, currency: payload.currency },
      'order.placed — attempting charge',
    );

    // Simulate acquirer latency.
    await new Promise((r) => setTimeout(r, 200));

    const events = ctx.scope.cradle.events as {
      payments: EventBus<typeof paymentsEvents>;
    };
    const success = Math.random() > 0.1;

    if (success) {
      const paymentId = randomUUID();
      await events.payments.paymentCaptured.publish(
        { orderId: payload.orderId },
        {
          paymentId,
          orderId: payload.orderId,
          userId: payload.userId,
          amount: payload.totalAmount,
          currency: payload.currency,
          capturedAt: new Date().toISOString(),
        },
      );
      ctx.logger.info({ orderId: payload.orderId, paymentId }, 'payment.captured');
    } else {
      await events.payments.paymentFailed.publish(
        { orderId: payload.orderId },
        {
          orderId: payload.orderId,
          userId: payload.userId,
          reason: 'insufficient_funds (demo)',
          failedAt: new Date().toISOString(),
        },
      );
      ctx.logger.warn({ orderId: payload.orderId }, 'payment.failed');
    }
  },
);
