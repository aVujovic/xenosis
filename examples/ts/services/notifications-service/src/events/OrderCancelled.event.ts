import { defineEventHandler } from '@xenosisorg/xenosis-core';
import ordersEvents from '@example/orders-events';

export default defineEventHandler(
  ordersEvents.topics.orderCancelled,
  async (payload, ctx) => {
    ctx.logger.warn(
      { orderId: payload.orderId, reason: payload.reason },
      '📧 [email:order-cancelled] "We are sorry — your order was cancelled"',
    );
  },
);
