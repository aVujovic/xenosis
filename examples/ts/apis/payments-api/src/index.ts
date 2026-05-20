import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * payments-service public API surface.
 *
 * Other services in the workspace call these through `this.api.payments.*`
 * after declaring `peers.payments` in their config. Routes mirror the REST
 * controllers under `services/payments-service/src/api/**`.
 *
 * payments-service is locked down with `boundaries.allowedCallers: ["orders"]`
 * — only orders-service may charge. A call from any other service is rejected
 * with 403 at the request boundary.
 */

const chargeSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type PaymentsApi = {
  charge(input: z.infer<typeof chargeSchema>): Promise<{
    paymentId: string;
    orderId: string;
    status: 'captured';
    amount: number;
    currency: string;
  }>;
};

export default defineServiceApi<PaymentsApi>({
  name: 'payments',
  routes: {
    charge: { method: 'POST', path: '/api/v1/payments/charge' },
  },
});
