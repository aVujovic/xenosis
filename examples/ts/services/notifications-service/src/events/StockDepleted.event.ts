import { defineEventHandler } from '@xenosisorg/xenosis-core';
import inventoryEvents from '@example/inventory-events';

export default defineEventHandler(
  inventoryEvents.topics.stockDepleted,
  async (payload, ctx) => {
    ctx.logger.warn(
      { orderId: payload.orderId, skus: payload.outOfStockSkus },
      '🚨 [ops-alert] SKUs depleted — investigate',
    );
  },
);
