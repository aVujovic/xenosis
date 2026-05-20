import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

const greetSchema = z.object({
  name: z.string().min(1),
});

/**
 * @typedef {import('@xenosisorg/xenosis-core').IServer} IServer
 * @typedef {import('../../services/Example.service.js').default} ExampleService
 */

/** @param {{ server: IServer; exampleService: ExampleService }} deps */
export default function ExampleController({ server, exampleService }) {
  const router = Router();

  router.route('/').get(
    Handler(async () => {
      const greeting = exampleService.greet('world');
      return Response.OK({ message: greeting });
    }),
  );

  router.route('/').post(
    Handler(Request.Body(greetSchema), async (body) => {
      return Response.OK({ message: exampleService.greet(body.name) });
    }),
  );

  server.use('/api/v1/example', router);
}
