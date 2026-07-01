import { defineEventApi, z } from '@xenosisorg/xenosis-core';

/**
 * Order lifecycle events emitted by orders-service.
 *
 * Wire topics use a dotted namespace so a broker cluster can group them
 * under `orders.*` — Redpanda / Kafka partition by key; NATS routes by
 * subject; Redis Streams treats each as a stream key.
 */
export default defineEventApi({
  name: 'orders-events',
  transport: 'redpanda',
  description: 'Order lifecycle events emitted by orders-service.',
  topics: {
    orderPlaced: {
      topic: 'orders.order.placed',
      description: 'A customer submitted an order — payment + stock reservation pending.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        userId: z.string(),
        items: z
          .array(
            z.object({
              sku: z.string(),
              quantity: z.number().int().positive(),
              unitPrice: z.number().int().positive(),
            }),
          )
          .min(1),
        currency: z.string().length(3),
        totalAmount: z.number().int().positive(),
        placedAt: z.string().datetime(),
      }),
    },
    orderConfirmed: {
      topic: 'orders.order.confirmed',
      description: 'Stock reserved and payment captured — order proceeds to fulfilment.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        userId: z.string(),
        confirmedAt: z.string().datetime(),
      }),
    },
    orderCancelled: {
      topic: 'orders.order.cancelled',
      description: 'Order cancelled — either payment failed or stock unavailable.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        userId: z.string(),
        reason: z.enum(['payment_failed', 'out_of_stock', 'user_cancelled']),
        cancelledAt: z.string().datetime(),
      }),
    },
    orderShipped: {
      topic: 'orders.order.shipped',
      description: 'Fulfilment centre handed the parcel to the carrier.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        userId: z.string(),
        carrier: z.string(),
        trackingNumber: z.string(),
        shippedAt: z.string().datetime(),
      }),
    },
  },
});
