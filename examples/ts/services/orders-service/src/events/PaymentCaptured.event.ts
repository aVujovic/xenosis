import { defineEventHandler } from '@xenosisorg/xenosis-core';
import type { EventBus } from '@xenosisorg/xenosis-core';
import paymentsEvents from '@example/payments-events';
import type ordersEvents from '@example/orders-events';

/**
 * payment.captured → mark the order confirmed. Handler resolves the orders
 * EventBus from the per-message awilix scope so the confirm publish carries
 * the same trace context as the inbound payment event.
 */
export default defineEventHandler(
  paymentsEvents.topics.paymentCaptured,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId, amount: payload.amount },
      'payment.captured — confirming order',
    );

    const events = ctx.scope.cradle.events as {
      orders: EventBus<typeof ordersEvents>;
    };
    await events.orders.orderConfirmed.publish(
      { orderId: payload.orderId },
      {
        orderId: payload.orderId,
        userId: payload.userId,
        confirmedAt: new Date().toISOString(),
      },
    );
  },
);
