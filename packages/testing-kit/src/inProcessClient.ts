import {
  createPeerClient,
  buildReliabilityPolicy,
  type PeerApi,
  type PeerClient,
  type PeerTransport,
  type TransportRequest,
} from '@xenosisorg/xenosis-core';
import request from 'supertest';

/**
 * A PeerTransport that drives an in-process Express app via supertest instead
 * of a real socket. Lets a test call a service through its OWN typed API
 * contract — the same Proxy + zod + path-param machinery production callers use
 * — without listening on a port.
 */
function inProcessTransport(app: unknown): PeerTransport {
  return {
    async execute<TResponse>(req: TransportRequest): Promise<TResponse> {
      const agent = request(app as never);
      const method = req.method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';

      let r = agent[method](req.url);
      for (const [k, v] of Object.entries(req.headers ?? {})) r = r.set(k, String(v));
      if (req.body !== undefined && req.method !== 'GET') r = r.send(req.body as object);

      const res = await r;
      if (res.status >= 400) {
        // Mirror PeerHttpError shape loosely so error assertions still work.
        const err = new Error(
          `in-process ${req.method} ${req.url} → HTTP ${res.status}`,
        ) as Error & { status: number; body: unknown };
        err.status = res.status;
        err.body = res.body;
        throw err;
      }
      return res.body as TResponse;
    },
  };
}

/**
 * Build a type-safe client for an API spec, routed at the in-process app.
 * Returned by `ctx.client(apiSpec)`.
 */
export function createInProcessClient<
  TApi extends Record<string, (...args: any[]) => Promise<any>>,
>(app: unknown, api: PeerApi<TApi>): PeerClient<TApi> {
  return createPeerClient<TApi>({
    api,
    transport: inProcessTransport(app),
    policy: buildReliabilityPolicy({}),
  });
}
