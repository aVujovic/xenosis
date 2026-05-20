import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import type ExampleService from '../../services/Example.service';
import { z } from 'zod';

const greetSchema = z.object({
  name: z.string().min(1),
});

export default function ExampleController({
  server,
  exampleService,
}: {
  server: IServer;
  exampleService: ExampleService;
}) {
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
