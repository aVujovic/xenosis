import { asFunction } from 'awilix';
import { Exception } from '@xenosisorg/xenosis-core';

/**
 * @typedef {import('@xenosisorg/xenosis-core').SharedModule} SharedModule
 * @typedef {import('express').Request} ExpressRequest
 *
 * @typedef {Object} ResolvedTenant
 * @property {string} id
 * @property {string} subdomain
 * @property {'free' | 'pro' | 'enterprise'} plan
 * @property {string} region
 */

/**
 * Demo tenant resolver (JavaScript variant).
 *
 * Reads either `x-tenant-id` header or the first subdomain segment from
 * the Host header. In a real app this would usually go to a database or
 * a tenant-cache.
 *
 * Cradle key: `resolveTenantJs`
 *
 * Usage:
 *
 *   Handler(resolveTenantJs, async (tenant) => Response.OK(tenant))
 *
 * Pattern is identical to the TypeScript version
 * (examples/ts/shared-modules/resolve-tenant). The only difference is
 * that types are described in JSDoc instead of TS syntax.
 */

/** @type {SharedModule} */
const module = {
  name: 'resolveTenantJs',

  register(container) {
    container.register({
      resolveTenantJs: asFunction(() => {
        /**
         * @param {ExpressRequest} req
         * @returns {Promise<ResolvedTenant>}
         */
        return async (req) => {
          const headerTenant = req.header('x-tenant-id');
          const host = req.header('host') ?? '';
          const subdomain = headerTenant ?? host.split('.')[0] ?? '';

          if (!subdomain || subdomain === 'localhost' || /^\d/.test(subdomain)) {
            throw Exception.BadRequest({
              reason: 'cannot determine tenant from request',
            });
          }

          return {
            id: `tenant_${subdomain}`,
            subdomain,
            plan: 'pro',
            region: 'eu-west-1',
          };
        };
      }).singleton(),
    });
  },
};

export default module;
