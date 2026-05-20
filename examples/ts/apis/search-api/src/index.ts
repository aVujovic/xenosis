import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * search-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.search.*` after declaring `peers.search` in their config.
 *
 * Types live here, in the API package, because this file is the single
 * source of truth for the inter-service contract — both caller and provider
 * import from `@example/search-api`.
 *
 * Routes mirror the REST controllers under
 * `services/search-service/src/api/**`. Keep them in sync by running
 * `xenosis sync api search` after adding or changing a `@peer` route.
 */

const greetSchema = z.object({
  name: z.string().min(1),
});

export type SearchApi = {
  greet(input: z.infer<typeof greetSchema>): Promise<{ message: string }>;
};

export default defineServiceApi<SearchApi>({
  name: 'search',
  routes: {
    greet: { method: 'POST', path: '/api/v1/example' },
  },
});
