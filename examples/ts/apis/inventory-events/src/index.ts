import { defineEventApi, z } from '@xenosisorg/xenosis-core';

/**
 * Stock lifecycle events emitted by inventory-service.
 *
 * Consumed by orders-service (to confirm or cancel the order) and
 * notifications-service (to alert operations on depleted SKUs).
 */
export default defineEventApi({
  name: 'inventory-events',
  transport: 'redpanda',
  description: 'Stock lifecycle events emitted by inventory-service.',
  topics: {
    stockReserved: {
      topic: 'inventory.stock.reserved',
      description: 'Requested SKUs held for the order — orders-service can confirm.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        items: z
          .array(z.object({ sku: z.string(), quantity: z.number().int().positive() }))
          .min(1),
        reservedAt: z.string().datetime(),
      }),
    },
    stockDepleted: {
      topic: 'inventory.stock.depleted',
      description: 'At least one SKU is out of stock — order should be cancelled.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        outOfStockSkus: z.array(z.string()).min(1),
        depletedAt: z.string().datetime(),
      }),
    },
  },
});
