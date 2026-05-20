import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type OrderService from '../../services/Order.service';

const createOrderSchema = z.object({ userId: z.string().min(1) });
const markPaidParams = z.object({ orderId: z.string().min(1) });
const markPaidBody = z.object({ paymentId: z.string().min(1) });

export default function OrderController({
  server,
  orderService,
}: {
  server: IServer;
  orderService: OrderService;
}) {
  const router = Router();

  /** @peer createOrder */
  router.route('/').post(
    Handler(Request.Body(createOrderSchema), async ({ userId }) => {
      return Response.Created(await orderService.createOrder(userId));
    }),
  );

  /** @peer markPaid */
  router.route('/:orderId/paid').post(
    Handler(
      Request.Params(markPaidParams),
      Request.Body(markPaidBody),
      async ({ orderId }, { paymentId }) => {
        return Response.OK(orderService.markPaid(orderId, paymentId));
      },
    ),
  );

  server.use('/api/v1/orders', router);
}
