import { defineServiceApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * notifications-service public API surface.
 *
 * Other services call these through `this.api.notifications.*` after declaring
 * `peers.notifications` in their config. Routes mirror the REST controllers
 * under `services/notifications-service/src/api/**`.
 */

const orderConfirmedSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  total: z.number().nonnegative(),
  currency: z.string().length(3),
});

export type NotificationsApi = {
  orderConfirmed(input: z.infer<typeof orderConfirmedSchema>): Promise<{
    notified: boolean;
    channel: string;
  }>;
};

export default defineServiceApi<NotificationsApi>({
  name: 'notifications',
  routes: {
    orderConfirmed: { method: 'POST', path: '/api/v1/notifications/order-confirmed' },
  },
});
