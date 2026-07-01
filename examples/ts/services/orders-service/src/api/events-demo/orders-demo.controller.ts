import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer, EventBus } from '@xenosisorg/xenosis-core';
import type ordersEvents from '@example/orders-events';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

/**
 * Kick-off point for the events pipeline demo. A single POST here publishes
 * `orders.order.placed`, and the rest of the mesh (payments-service,
 * inventory-service, notifications-service, analytics-service) reacts.
 *
 * Try it once the demo infra is up:
 *
 *   curl -X POST http://localhost:4018/api/events-demo/orders \
 *     -H 'content-type: application/json' \
 *     -d '{"userId":"u1","items":[{"sku":"sku-1","quantity":2,"unitPrice":1000}],"currency":"USD"}'
 *
 * Then watch:
 *   - `xenosis dev` dashboard → Events tab: producer/consumer mesh.
 *   - Redpanda Console at http://localhost:8086: message flow.
 *   - Each service's stdout: trace ids propagate end-to-end.
 */
const placeOrderSchema = z.object({
  userId: z.string(),
  items: z
    .array(
      z.object({
        sku: z.string(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().int().positive(),
      }),
    )
    .min(1),
  currency: z.string().length(3).default('USD'),
});

export default function OrdersDemoController({
  server,
  events,
}: {
  server: IServer;
  events: { orders: EventBus<typeof ordersEvents> };
}) {
  const router = Router();

  router.route('/').post(
    Handler(Request.Body(placeOrderSchema), async (body) => {
      const orderId = randomUUID();
      const totalAmount = body.items.reduce(
        (sum, i) => sum + i.quantity * i.unitPrice,
        0,
      );

      await events.orders.orderPlaced.publish(
        { orderId },
        {
          orderId,
          userId: body.userId,
          items: body.items,
          currency: body.currency,
          totalAmount,
          placedAt: new Date().toISOString(),
        },
      );

      return Response.Created({
        orderId,
        totalAmount,
        status: 'pending',
        message: 'order.placed emitted — watch the pipeline in the dashboard',
      });
    }),
  );

  server.use('/api/events-demo/orders', router);
  return server;
}
