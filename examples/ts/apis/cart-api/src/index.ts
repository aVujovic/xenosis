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

const getCartSchema = z.object({
  userId: z.string().min(1),
});

export interface CartLine {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export type CartApi = {
  getCart(input: z.infer<typeof getCartSchema>): Promise<{
    userId: string;
    lines: CartLine[];
  }>;
};

export default defineServiceApi<CartApi>({
  name: 'cart',
  routes: {
    getCart: { method: 'GET', path: '/api/v1/carts/:userId' },
  },
});
