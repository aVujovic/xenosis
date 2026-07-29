import { Router } from '@xenosisorg/xenosis-core';
import type { IServer, XReq, XRes } from '@xenosisorg/xenosis-core';

export default function HealthcheckController({ server }: { server: IServer }) {
  const router = Router();

  router.get('/', (_req: XReq, res: XRes) => {
    res.status(200).send('{{serviceName}} is healthy!');
  });

  server.use('/healthcheck', router);
  return server;
}
