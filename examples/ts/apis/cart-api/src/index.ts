import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * cart-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.cart.*` after declaring `peers.cart` in their config.
 *
 * Types live here, in the API package, because this file is the single
 * source of truth for the inter-service contract — both caller and provider
 * import from `@example/cart-api`.
 *
 * Routes mirror the REST controllers under
 * `services/cart-service/src/api/**`. Keep them in sync by running
 * `xenosis sync api cart` after adding or changing a `@peer` route.
 */

const greetSchema = z.object({
  name: z.string().min(1),
});

export type CartApi = {
  greet(input: z.infer<typeof greetSchema>): Promise<{ message: string }>;
};

export default defineServiceApi<CartApi>({
  name: 'cart',
  routes: {
    greet: { method: 'POST', path: '/api/v1/example' },
  },
});
