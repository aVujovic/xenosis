import { defineEventHandler } from '@xenosisorg/xenosis-core';
import ordersEvents from '@example/orders-events';

export default defineEventHandler(
  ordersEvents.topics.orderConfirmed,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId },
      '📧 [email:order-confirmed] "Your order is on its way"',
    );
  },
);
