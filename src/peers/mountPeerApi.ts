import type { PeerApi, PeerHandlers, RouteSpec } from './types';
import { Exception } from '../rest/Exception';
import type { XReq, XRes, XNext, XServer } from '../rest/http';

/**
 * Mount every route declared in `api.routes` on the HTTP server, wired to the
 * provided handlers. Body parsing is set up by the framework adapter (Express
 * via express.json(), Hono via its built-in parser).
 *
 * For each route:
 *   1. Combine path params + query (GET) or path params + body (others) into `input`.
 *   2. Validate against `route.bodySchema` if present (zod).
 *   3. Call handler, await result.
 *   4. Validate output against `route.responseSchema` if present.
 *   5. Send JSON 200 (or 204 if undefined).
 *
 * Errors propagate to Xenosis's errorHandlerMiddleware.
 */
export function mountPeerApi<
  TApi extends Record<string, (...args: any[]) => Promise<any>>,
>(
  server: XServer,
  api: PeerApi<TApi>,
  handlers: PeerHandlers<TApi>,
): void {
  for (const [methodName, route] of Object.entries(api.routes) as [
    keyof TApi,
    RouteSpec,
  ][]) {
    const handler = handlers[methodName];
    if (typeof handler !== 'function') {
      throw new Error(
        `[xenosis/peers] mountPeerApi(${api.name}): missing handler for "${String(methodName)}"`,
      );
    }

    const verb = route.method.toLowerCase() as
      | 'get'
      | 'post'
      | 'put'
      | 'patch'
      | 'delete';

    server[verb](
      route.path,
      buildHandler(api.name, String(methodName), route, handler),
    );
  }
}

function buildHandler(
  apiName: string,
  methodName: string,
  route: RouteSpec,
  handler: (input: any) => Promise<unknown>,
) {
  return async (req: XReq, res: XRes, next: XNext) => {
    try {
      // Merge path params + (query for GET / body for everything else). Body is
      // parsed upstream by the framework adapter (express.json / Hono body
      // parser) into an object — cast for the spread since XReq.body is unknown.
      const reqBody = (req.body ?? {}) as Record<string, unknown>;
      const rawInput =
        route.method === 'GET'
          ? { ...req.query, ...req.params }
          : { ...reqBody, ...req.params };

      let input: unknown = rawInput;
      if (route.bodySchema) {
        const parsed = await route.bodySchema.safeParseAsync(rawInput);
        if (!parsed.success) {
          throw Exception.BadRequest({
            peer: apiName,
            method: methodName,
            issues: parsed.error.issues,
          });
        }
        input = parsed.data;
      }

      const result = await handler(input);

      let body: unknown = result;
      if (route.responseSchema && result !== undefined) {
        const parsed = await route.responseSchema.safeParseAsync(result);
        if (!parsed.success) {
          // Server emitted a payload that violates its own contract — surface clearly.
          throw new Error(
            `[xenosis/peers] ${apiName}.${methodName}: response failed schema — ${JSON.stringify(parsed.error.issues)}`,
          );
        }
        body = parsed.data;
      }

      if (body === undefined) {
        res.status(204).end();
      } else {
        res.status(200).json(body);
      }
    } catch (err) {
      next(err);
    }
  };
}
