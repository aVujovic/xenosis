import { defineEventApi, z } from '@xenosisorg/xenosis-core';

/**
 * Payment lifecycle events emitted by payments-service.
 *
 * Consumed by orders-service (to mark the order paid or cancel it) and
 * analytics-service (to build revenue dashboards).
 */
export default defineEventApi({
  name: 'payments-events',
  transport: 'redpanda',
  description: 'Payment lifecycle events emitted by payments-service.',
  topics: {
    paymentCaptured: {
      topic: 'payments.payment.captured',
      description: 'Charge succeeded — money is on the way from the acquirer.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        paymentId: z.string(),
        orderId: z.string(),
        userId: z.string(),
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        capturedAt: z.string().datetime(),
      }),
    },
    paymentFailed: {
      topic: 'payments.payment.failed',
      description: 'Charge failed — order must be cancelled and the user notified.',
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId: z.string(),
        userId: z.string(),
        reason: z.string(),
        failedAt: z.string().datetime(),
      }),
    },
  },
});
