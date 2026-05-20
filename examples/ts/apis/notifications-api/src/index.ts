import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * notifications-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.notifications.*` after declaring `peers.notifications` in their config.
 *
 * Types live here, in the API package, because this file is the single
 * source of truth for the inter-service contract — both caller and provider
 * import from `@example/notifications-api`.
 *
 * Routes mirror the REST controllers under
 * `services/notifications-service/src/api/**`. Keep them in sync by running
 * `xenosis sync api notifications` after adding or changing a `@peer` route.
 */

const greetSchema = z.object({
  name: z.string().min(1),
});

export type NotificationsApi = {
  greet(input: z.infer<typeof greetSchema>): Promise<{ message: string }>;
};

export default defineServiceApi<NotificationsApi>({
  name: 'notifications',
  routes: {
    greet: { method: 'POST', path: '/api/v1/example' },
  },
});
