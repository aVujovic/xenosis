import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type ChargeService from '../../services/Charge.service';

/**
 * billing-service REST controller. These are the same routes declared in
 * `apis/billing-api` — sibling services consume them through the typed
 * proxy as `this.api.billing.*`, public clients hit them directly.
 *
 * Add `@peer <methodName>` to any route you want exposed through the peer
 * surface, then run `xenosis sync api billing` to update `apis/billing-api`.
 */
const createChargeSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
});

const refundSchema = z.object({
  chargeId: z.string().uuid(),
  reason: z.string().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export default function ChargeController({
  server,
  chargeService,
}: {
  server: IServer;
  chargeService: ChargeService;
}) {
  const router = Router();

  /** @peer createCharge */
  router.route('/').post(
    Handler(Request.Body(createChargeSchema), async (body) => {
      const charge = await chargeService.create(body);
      return Response.Created(charge);
    }),
  );

  /** @peer refund */
  router.route('/refund').post(
    Handler(Request.Body(refundSchema), async (body) => {
      await chargeService.refund(body);
      return Response.OK({ ok: true });
    }),
  );

  /** @peer getCharge */
  router.route('/:id').get(
    Handler(Request.Params(idParamSchema), async ({ id }) => {
      const charge = await chargeService.get(id);
      return Response.OK(charge);
    }),
  );

  server.use('/api/v1/charges', router);
  return server;
}
