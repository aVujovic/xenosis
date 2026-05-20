import { Router } from '@xenosisorg/xenosis-core';

/**
 * @typedef {import('@xenosisorg/xenosis-core').IServer} IServer
 */

/** @param {{ server: IServer }} deps */
export default function HealthcheckController({ server }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.status(200).send('{{serviceName}} is healthy!');
  });

  server.use('/healthcheck', router);
  return server;
}
