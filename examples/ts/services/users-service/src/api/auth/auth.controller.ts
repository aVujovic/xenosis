import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import type AuthService from '../../services/Auth.service';
import { loginBodySchema } from './auth.schema';

/**
 * Auth endpoints — all PUBLIC (no token required).
 *
 * Demo-grade login: pass an existing email, get a JWT back. Real apps would
 * pair this with hashed-password verification.
 */
export default function AuthController({
  server,
  authService,
}: {
  server: IServer;
  authService: AuthService;
}) {
  const router = Router();

  router.route('/login').post(
    Handler(Request.Body(loginBodySchema), async (body) => {
      const result = await authService.loginByEmail(body.email);
      return Response.OK(result);
    }),
  );

  server.use('/api/v1/auth', router);
  return server;
}
