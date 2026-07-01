import { defineEventHandler } from '@xenosisorg/xenosis-core';
import ordersEvents from '@example/orders-events';

/**
 * order.placed → send "order received" email. Stubbed to a log line — the
 * demo isn't about SMTP.
 */
export default defineEventHandler(
  ordersEvents.topics.orderPlaced,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId, userId: payload.userId, total: payload.totalAmount },
      '📧 [email:order-received] "Thanks for your order"',
    );
  },
);
