import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type NotificationService from '../../services/Notification.service';

const orderConfirmedSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  total: z.number().nonnegative(),
  currency: z.string().length(3),
});

export default function NotificationsController({
  server,
  notificationService,
}: {
  server: IServer;
  notificationService: NotificationService;
}) {
  const router = Router();

  /** @peer orderConfirmed */
  router.route('/order-confirmed').post(
    Handler(Request.Body(orderConfirmedSchema), async (body) => {
      return Response.OK(notificationService.orderConfirmed(body));
    }),
  );

  server.use('/api/v1/notifications', router);
}
