import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * payments-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.payments.*` after declaring `peers.payments` in their config.
 *
 * Types live here, in the API package, because this file is the single
 * source of truth for the inter-service contract — both caller and provider
 * import from `@example/payments-api`.
 *
 * Routes mirror the REST controllers under
 * `services/payments-service/src/api/**`. Keep them in sync by running
 * `xenosis sync api payments` after adding or changing a `@peer` route.
 */

const greetSchema = z.object({
  name: z.string().min(1),
});

export type PaymentsApi = {
  greet(input: z.infer<typeof greetSchema>): Promise<{ message: string }>;
};

export default defineServiceApi<PaymentsApi>({
  name: 'payments',
  routes: {
    greet: { method: 'POST', path: '/api/v1/example' },
  },
});
