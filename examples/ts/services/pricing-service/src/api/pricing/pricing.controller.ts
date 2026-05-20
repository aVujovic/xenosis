import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type PricingService from '../../services/Pricing.service';

const quoteSchema = z.object({
  lines: z.array(
    z.object({
      sku: z.string(),
      qty: z.number().int().positive(),
      unitPrice: z.number().nonnegative(),
    }),
  ),
});

export default function PricingController({
  server,
  pricingService,
}: {
  server: IServer;
  pricingService: PricingService;
}) {
  const router = Router();

  /** @peer quote */
  router.route('/quote').post(
    Handler(Request.Body(quoteSchema), async ({ lines }) => {
      return Response.OK(pricingService.quote(lines));
    }),
  );

  server.use('/api/v1/pricing', router);
}
