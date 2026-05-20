import type { PeerApi } from './types';

/**
 * Identity helper for declaring a peer API contract in a shared npm package.
 *
 * Gives full TS inference: TS verifies that every method on the consumer
 * interface has a matching route entry, and infers input/output types from the
 * interface signatures for `bodySchema` / `responseSchema`.
 *
 * Runtime: minimal — just freezes the spec to discourage mutation.
 */
export function definePeerApi<
  TApi extends Record<string, (...args: any[]) => Promise<any>>,
>(spec: PeerApi<TApi>): PeerApi<TApi> {
  if (!spec.name) {
    throw new Error('definePeerApi: spec.name is required');
  }
  if (!spec.routes || typeof spec.routes !== 'object') {
    throw new Error('definePeerApi: spec.routes is required');
  }
  for (const [method, route] of Object.entries(spec.routes)) {
    if (!route.method || !route.path) {
      throw new Error(
        `definePeerApi: route "${method}" missing method or path`,
      );
    }
  }
  return Object.freeze(spec);
}
