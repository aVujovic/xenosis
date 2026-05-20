import { defineServiceApi } from '@xenosisorg/xenosis-core';

/**
 * users-service public API surface.
 *
 * Other services in the workspace can call these endpoints through
 * `this.api.users.*` after declaring `peers.users` in their config.
 *
 * Types live here, in the API package, because this file is the single
 * source of truth for the inter-service contract — both caller and provider
 * import from `@example/users-api`.
 *
 * Routes mirror the REST controllers under `services/users-service/src/api/**`.
 * Keep them in sync by running `xenosis sync api users` after adding or
 * changing a route.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string | Date;
}

export interface ListUsersQuery {
  limit: number;
  cursor?: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
}

export interface UpgradeInput {
  amount: number;
  currency: string;
}

export type UsersServiceApi = {
  chargeDemo(): Promise<{ ok: true; userId: string; charge: unknown }>;
  list(query: ListUsersQuery): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  findById(params: { id: string }): Promise<User | null>;
  upgrade(input: UpgradeInput & { id: string }): Promise<{ user: User; charge: unknown }>;
};

export default defineServiceApi<UsersServiceApi>({
  name: 'users',
  routes: {
    chargeDemo: { method: 'GET',   path: '/api/v1/users/charge-demo' },
    create    : { method: 'POST',  path: '/api/v1/users' },
    findById  : { method: 'GET',   path: '/api/v1/users/:id' },
    list      : { method: 'GET',   path: '/api/v1/users' },
    upgrade   : { method: 'POST',  path: '/api/v1/users/:id/upgrade' },
  },
});
