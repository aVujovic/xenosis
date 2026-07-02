import { defineEventHandler } from '@xenosisorg/xenosis-core';
import type { ProducerBus } from '@xenosisorg/xenosis-core';
import inventoryEvents from '@example/inventory-events';
import type ordersEvents from '@example/orders-events';

/**
 * stock.depleted → cancel the order with reason "out_of_stock".
 */
export default defineEventHandler(
  inventoryEvents.topics.stockDepleted,
  async (payload, ctx) => {
    ctx.logger.warn(
      { orderId: payload.orderId, skus: payload.outOfStockSkus },
      'stock.depleted — cancelling order',
    );

    const events = ctx.scope.cradle.events as {
      orders: ProducerBus<
        typeof ordersEvents,
        'orderPlaced' | 'orderConfirmed' | 'orderCancelled'
      >;
    };
    // We don't know the userId from the inventory event alone in this demo;
    // a real service would look it up. Using 'unknown' as a stand-in.
    await events.orders.orderCancelled.publish(
      { orderId: payload.orderId },
      {
        orderId: payload.orderId,
        userId: 'unknown',
        reason: 'out_of_stock',
        cancelledAt: new Date().toISOString(),
      },
    );
  },
);
