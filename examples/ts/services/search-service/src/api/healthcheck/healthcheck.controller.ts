import { Router } from '@xenosisorg/xenosis-core';
import type { IServer, ExpressRequest, ExpressResponse } from '@xenosisorg/xenosis-core';

export default function HealthcheckController({ server }: { server: IServer }) {
  const router = Router();

  router.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).send('search-service is healthy!');
  });

  server.use('/healthcheck', router);
  return server;
}
