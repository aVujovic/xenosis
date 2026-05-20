import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * orders-service public API surface.
 *
 * orders-service is the orchestrator of the checkout flow: `createOrder` fans
 * out to cart → pricing → payments → notifications. `markPaid` is the callback
 * payments-service hits once a charge is captured.
 *
 * Other services call these through `this.api.orders.*` after declaring
 * `peers.orders` in their config. Routes mirror the REST controllers under
 * `services/orders-service/src/api/**`.
 */

const createOrderSchema = z.object({
  userId: z.string().min(1),
});

const markPaidSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
});

export interface OrderRecord {
  id: string;
  userId: string;
  status: 'pending' | 'paid';
  total: number;
  currency: string;
  paymentId?: string;
}

export type OrdersApi = {
  createOrder(input: z.infer<typeof createOrderSchema>): Promise<OrderRecord>;
  markPaid(input: z.infer<typeof markPaidSchema>): Promise<OrderRecord>;
};

export default defineServiceApi<OrdersApi>({
  name: 'orders',
  routes: {
    createOrder: { method: 'POST', path: '/api/v1/orders' },
    markPaid: { method: 'POST', path: '/api/v1/orders/:orderId/paid' },
  },
});
