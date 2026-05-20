import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import type HttpBinService from '../../services/HttpBin.service';
import { echoBodySchema, statusParamSchema } from './httpbin.schema';

/**
 * Routes for the external httpbin demo. Mounted at /api/v1/httpbin.
 *
 * - POST /echo            → form-urlencoded body, Bearer header, echoes back
 * - GET  /status/:code    → forces httpbin to return the chosen status; the
 *                           external errorMapper translates it into a Xenosis
 *                           Exception, which the global error middleware emits
 *                           as JSON.
 */
export default function HttpBinController({
  server,
  httpBinService,
}: {
  server: IServer;
  httpBinService: HttpBinService;
}) {
  const router = Router();

  router.route('/echo').post(
    Handler(Request.Body(echoBodySchema), async (body) => {
      const echo = await httpBinService.echo(body);
      return Response.OK(echo);
    }),
  );

  router.route('/status/:code').get(
    Handler(Request.Params(statusParamSchema), async ({ code }) => {
      const result = await httpBinService.forceStatus(code);
      return Response.OK(result);
    }),
  );

  server.use('/api/v1/httpbin', router);
  return server;
}
