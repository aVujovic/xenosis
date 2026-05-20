import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import { z } from 'zod';
import type CartService from '../../services/Cart.service';

const userIdParam = z.object({ userId: z.string().min(1) });

export default function CartController({
  server,
  cartService,
}: {
  server: IServer;
  cartService: CartService;
}) {
  const router = Router();

  /** @peer getCart */
  router.route('/:userId').get(
    Handler(Request.Params(userIdParam), async ({ userId }) => {
      return Response.OK(cartService.getCart(userId));
    }),
  );

  server.use('/api/v1/carts', router);
}
