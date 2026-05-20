import { asFunction } from 'awilix';
import type { Request } from 'express';
import { Exception, type SharedModule } from '@xenosisorg/xenosis-core';

export interface ResolvedTenant {
  id: string;
  subdomain: string;
  plan: 'free' | 'pro' | 'enterprise';
  region: string;
}

/**
 * Demo tenant resolver. Reads either `x-tenant-id` header or the first
 * subdomain segment from the Host header. In a real app this would
 * usually go to a database or a tenant-cache.
 *
 * Cradle key: `resolveTenant`
 *
 * Usage:
 *
 *   Handler(resolveTenant, async (tenant) => Response.OK(tenant))
 *
 * Stack with other resolvers — order is left-to-right, so a resolver that
 * depends on another (e.g. tenant-aware user lookup) must come after it.
 */
const module: SharedModule = {
  name: 'resolveTenant',

  register(container) {
    container.register({
      resolveTenant: asFunction(() => {
        return async (req: Request): Promise<ResolvedTenant> => {
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
