import { asFunction } from 'awilix';
import { Exception, type SharedModule, type XReq } from '@xenosisorg/xenosis-core';

export interface ResolvedUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

/**
 * Resolver shape: a function `(req) => value` that Handler(...) calls
 * on every request. Same contract as Request.Body / Request.Query.
 *
 * Registered as a SINGLETON via asFunction — the function itself is built once,
 * but it runs per-request inside Handler.
 *
 * Cradle key: `resolveUser`
 *
 * Usage inside a controller:
 *
 *   export default function UserController({ server, resolveUser }) {
 *     router.route('/me').get(
 *       Handler(resolveUser, async (user) => Response.OK(user))
 *     );
 *   }
 *
 * This demo returns a hardcoded user. In a real app, replace the body of the
 * inner function with whatever fetch you need: JWT decode, repository lookup,
 * cache hit, identity-provider call, etc.
 */
const module: SharedModule = {
  name: 'resolveUser',

  register(container) {
    container.register({
      resolveUser: asFunction(() => {
        return async (req: XReq): Promise<ResolvedUser> => {
          const currentUser = req.scope?.cradle.currentUser as
            | { id?: string; email?: string; name?: string }
            | undefined;

          if (!currentUser?.id) {
            throw Exception.Unauthorized({ reason: 'no authenticated user' });
          }

          return {
            id: currentUser.id,
            email: currentUser.email ?? 'unknown@example.com',
            name: currentUser.name ?? 'Unknown',
            roles: ['user'],
          };
        };
      }).singleton(),
    });
  },
};

export default module;
