import type { PeerApi } from './types';
import { definePeerApi } from './definePeerApi';

/**
 * Declare a service's own API surface so other services in the workspace can
 * call it through a type-safe proxy.
 *
 * This is a thin wrapper around `definePeerApi` with two conceptual changes:
 *
 *  1. The declaration lives **inside the service's package**, not in a separate
 *     shared package. The service is its own contract source.
 *  2. Caller services consume every configured service through one aggregator
 *     cradle key — `this.api.users.createUser(...)` rather than per-peer keys.
 *
 * Mechanics are identical to `definePeerApi`, so the runtime (HTTP transport,
 * reliability policy, tracing) is shared. The new convention is purely
 * organisational — every service exports its own routes alongside the type
 * contract it implements via REST controllers.
 *
 * Example:
 *
 * ```ts
 * // users-service/src/index.ts
 * import { defineServiceApi } from '@xenosisorg/xenosis-core';
 * import type { User, CreateUserInput, ListUsersQuery } from './services/User.service';
 *
 * export type UsersServiceApi = {
 *   list(query: ListUsersQuery): Promise<User[]>;
 *   create(input: CreateUserInput): Promise<User>;
 *   findById(params: { id: string }): Promise<User | null>;
 * };
 *
 * export default defineServiceApi<UsersServiceApi>({
 *   name: 'users',
 *   routes: {
 *     list:     { method: 'GET',  path: '/api/v1/users' },
 *     create:   { method: 'POST', path: '/api/v1/users' },
 *     findById: { method: 'GET',  path: '/api/v1/users/:id' },
 *   },
 * });
 * ```
 */
export function defineServiceApi<
  TApi extends Record<string, (...args: any[]) => Promise<any>>,
>(spec: PeerApi<TApi>): PeerApi<TApi> {
  return definePeerApi(spec);
}
