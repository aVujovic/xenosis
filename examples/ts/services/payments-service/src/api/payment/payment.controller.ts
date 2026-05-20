import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type PaymentService from '../../services/Payment.service';

const chargeSchema = z.object({
  orderId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().length(3),
});

export default function PaymentController({
  server,
  paymentService,
}: {
  server: IServer;
  paymentService: PaymentService;
}) {
  const router = Router();

  /** @peer charge */
  router.route('/charge').post(
    Handler(Request.Body(chargeSchema), async (body) => {
      return Response.OK(await paymentService.charge(body));
    }),
  );

  server.use('/api/v1/payments', router);
}
