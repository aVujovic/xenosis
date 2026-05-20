import { Handler, Response, Router } from '@xenosisorg/xenosis-core';

/**
 * @typedef {import('@xenosisorg/xenosis-core').IServer} IServer
 * @typedef {import('express').Request} ExpressRequest
 * @typedef {import('@example/resolve-tenant-js').ResolvedTenant} ResolvedTenant
 * @typedef {(req: ExpressRequest) => Promise<ResolvedTenant>} TenantResolver
 * @typedef {import('@example/psql-events-js').PrismaClient} EventsClient
 */

/**
 * Demonstrates two JS-side wiring patterns:
 *
 *  1. `resolveTenantJs` — a shared module registered as an awilix factory,
 *     pulled out of the cradle and used as a Handler selector.
 *  2. `eventsDb` — a Prisma client built from `@example/psql-events-js`
 *     (a JavaScript schema package) injected like any other cradle key.
 *
 * Both patterns are identical to the TypeScript equivalents — the only
 * difference is JSDoc instead of TS syntax.
 *
 * @param {{ server: IServer; resolveTenantJs: TenantResolver; eventsDb: EventsClient }} deps
 */
export default function TenantController({ server, resolveTenantJs, eventsDb }) {
  const router = Router();

  router.route('/').get(
    Handler(resolveTenantJs, async (tenant) => {
      // Write an audit row to the separate events database — proves the
      // JS-side schema package can coexist with the TS-side `mainDb`.
      await eventsDb.event.create({
        data: {
          type: 'tenant.resolved',
          payload: JSON.stringify({ tenantId: tenant.id, subdomain: tenant.subdomain }),
        },
      });

      return Response.OK(tenant);
    }),
  );

  server.use('/api/v1/tenant', router);
  return server;
}
