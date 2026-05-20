import { Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';

export default function HealthcheckController({ server }: { server: IServer }) {
  const router = Router();

  router.get('/', (_req, res) => {
    return res.status(200).send('users-service is healthy!');
  });

  server.use('/healthcheck', router);
  return server;
}
