import { defineEventHandler } from '@xenosisorg/xenosis-core';
import type { ProducerBus } from '@xenosisorg/xenosis-core';
import ordersEvents from '@example/orders-events';
import type inventoryEvents from '@example/inventory-events';

/**
 * order.placed → try to reserve stock. Emits inventory.stock.reserved on
 * success or inventory.stock.depleted when at least one SKU is unavailable.
 * Uses a tiny hard-coded stock table so the demo works without a database;
 * every 5th call to the same SKU depletes it to exercise the failure path.
 */

// In-memory stock map — enough to make the demo interactive without a DB.
const stock = new Map<string, number>();
const DEFAULT_STOCK = 4;

export default defineEventHandler(
  ordersEvents.topics.orderPlaced,
  async (payload, ctx) => {
    ctx.logger.info(
      { orderId: payload.orderId, items: payload.items.length },
      'order.placed — attempting to reserve stock',
    );

    // Simulate lookup latency.
    await new Promise((r) => setTimeout(r, 150));

    const outOfStock: string[] = [];
    for (const item of payload.items) {
      const on_hand = stock.get(item.sku) ?? DEFAULT_STOCK;
      if (on_hand < item.quantity) {
        outOfStock.push(item.sku);
      } else {
        stock.set(item.sku, on_hand - item.quantity);
      }
    }

    const events = ctx.scope.cradle.events as {
      inventory: ProducerBus<
        typeof inventoryEvents,
        'stockReserved' | 'stockDepleted'
      >;
    };

    if (outOfStock.length > 0) {
      await events.inventory.stockDepleted.publish(
        { orderId: payload.orderId },
        {
          orderId: payload.orderId,
          outOfStockSkus: outOfStock,
          depletedAt: new Date().toISOString(),
        },
      );
      ctx.logger.warn(
        { orderId: payload.orderId, outOfStock },
        'stock.depleted',
      );
    } else {
      await events.inventory.stockReserved.publish(
        { orderId: payload.orderId },
        {
          orderId: payload.orderId,
          items: payload.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
          reservedAt: new Date().toISOString(),
        },
      );
      ctx.logger.info({ orderId: payload.orderId }, 'stock.reserved');
    }
  },
);
