import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer, XReq, XHandler } from '@xenosisorg/xenosis-core';
import type { ResolvedUser } from '@example/resolve-user';
import type { ResolvedTenant } from '@example/resolve-tenant';
import type UserService from '../../services/User.service';
import {
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  upgradeBodySchema,
  userSchema,
  userListSchema,
} from './user.schema';

type Resolver<T> = (req: XReq) => Promise<T>;

export default function UserController({
  server,
  userService,
  authMiddleware,
  resolveUser,
  resolveTenant,
}: {
  server: IServer;
  userService: UserService;
  authMiddleware: XHandler;
  resolveUser: Resolver<ResolvedUser>;
  resolveTenant: Resolver<ResolvedTenant>;
}) {
  const router = Router();

  // ─────────── Public routes ───────────────────────────────────────────────

  /**
   * GET /api/v1/users/charge-demo — public cross-service smoke test.
   * Proves users-service can reach billing-service through
   * `this.api.billing.createCharge(...)`. Declared before `/:id` so the
   * Express router doesn't match `charge-demo` as a uuid param.
   *
   * @peer chargeDemo
   */
  router.route('/charge-demo').get(
    Handler(async () => {
      const result = await userService.chargeDemo();
      return Response.OK(result);
    }),
  );

  /** @peer list */
  router.route('/').get(
    Handler(Request.Query(listUsersQuerySchema), async (query) => {
      const users = await userService.list(query);
      return Response.OK(users);
    }).returns(userListSchema),
  );

  /**
   * POST /api/v1/users — public signup, stacks payload + tenant context.
   * Demonstrates that `Request.Body` (zod-validated payload) and a resolver
   * (`resolveTenant`) compose in the same Handler call. Each selector
   * contributes one positional argument, left-to-right.
   *
   * @peer create
   */
  router.route('/').post(
    Handler(
      Request.Body(createUserSchema),
      resolveTenant,
      async (body, tenant) => {
        const created = await userService.create(body);
        return Response.Created({ created, tenant });
      },
    ),
  );

  // ─────────── Protected routes ────────────────────────────────────────────
  // Apply `authMiddleware` BEFORE the Handler. On 401, the middleware throws
  // Exception.Unauthorized which Xenosis' errorHandlerMiddleware converts to a
  // JSON 401 response. On success it registers `currentUser` in the per-request
  // awilix scope so downstream services can inject it.

  /** @peer findById */
  router.route('/:id').get(
    authMiddleware,
    Handler(Request.Params(idParamSchema), async ({ id }) => {
      const user = await userService.findById(id);
      return user ? Response.OK(user) : Response.NotFound({ id });
    }).returns(userSchema),
  );

  /**
   * POST /api/v1/users/:id/upgrade — protected.
   * Internal peer call: invokes billing-service via `this.api.billing`
   * wired from `config.peers.billing.package = "@example/billing-api"`.
   *
   * @peer upgrade
   */
  router.route('/:id/upgrade').post(
    authMiddleware,
    Handler(
      Request.Params(idParamSchema),
      Request.Body(upgradeBodySchema),
      async (params, body) => {
        const result = await userService.upgrade({
          userId: params.id,
          amount: body.amount,
          currency: body.currency,
        });
        return Response.OK(result);
      },
    ),
  );

  server.use('/api/v1/users', router);
  return server;
}
