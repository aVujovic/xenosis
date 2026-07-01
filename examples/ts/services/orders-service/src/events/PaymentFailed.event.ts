import { defineEventHandler } from '@xenosisorg/xenosis-core';
import type { EventBus } from '@xenosisorg/xenosis-core';
import paymentsEvents from '@example/payments-events';
import type ordersEvents from '@example/orders-events';

/**
 * payment.failed → cancel the order with reason "payment_failed".
 */
export default defineEventHandler(
  paymentsEvents.topics.paymentFailed,
  async (payload, ctx) => {
    ctx.logger.warn(
      { orderId: payload.orderId, reason: payload.reason },
      'payment.failed — cancelling order',
    );

    const events = ctx.scope.cradle.events as {
      orders: EventBus<typeof ordersEvents>;
    };
    await events.orders.orderCancelled.publish(
      { orderId: payload.orderId },
      {
        orderId: payload.orderId,
        userId: payload.userId,
        reason: 'payment_failed',
        cancelledAt: new Date().toISOString(),
      },
    );
  },
);
