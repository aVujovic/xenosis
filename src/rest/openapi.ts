import { Router as ExpressRouter, type IRouter } from 'express';
import { ROUTE_META, type RouteMeta } from './Handler';

/**
 * One captured route: HTTP method, the path RELATIVE to the router (the prefix
 * from `server.use(prefix, router)` is joined later), and the metadata harvested
 * from its Handler (request schemas + optional response schema).
 */
export interface RouteRecord {
  method: string;
  path: string;
  meta?: RouteMeta;
}

export const ROUTER_ROUTES = Symbol.for('xenosis.routerRoutes');

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

interface RecordingRouter extends IRouter {
  [ROUTER_ROUTES]: RouteRecord[];
}

/** Pull RouteMeta off the last handler arg of a verb call, if present. */
function metaFromArgs(args: unknown[]): RouteMeta | undefined {
  const last = args[args.length - 1] as { [ROUTE_META]?: RouteMeta } | undefined;
  return last?.[ROUTE_META];
}

/** Build a RouteRecord, omitting `meta` entirely when absent (exactOptional). */
function mkRecord(method: string, path: string, args: unknown[]): RouteRecord {
  const meta = metaFromArgs(args);
  return meta ? { method, path, meta } : { method, path };
}

/**
 * Drop-in replacement for express.Router() that records every route it mounts
 * onto a hidden `[ROUTER_ROUTES]` array. Behaviour is otherwise identical — the
 * real Express methods are still called. Covers both styles:
 *   router.route('/x').get(Handler(...))
 *   router.get('/x', Handler(...))
 */
export function Router(...routerArgs: Parameters<typeof ExpressRouter>): IRouter {
  const router = ExpressRouter(...routerArgs) as RecordingRouter;
  const routes: RouteRecord[] = [];
  router[ROUTER_ROUTES] = routes;

  // Patch direct verb calls: router.get('/x', handler)
  for (const verb of VERBS) {
    const original = (router[verb] as (...a: unknown[]) => unknown).bind(router);
    (router as unknown as Record<string, unknown>)[verb] = (
      path: unknown,
      ...handlers: unknown[]
    ) => {
      if (typeof path === 'string') {
        routes.push(mkRecord(verb, path, handlers));
      }
      return original(path, ...handlers);
    };
  }

  // Patch chained calls: router.route('/x').get(handler).post(handler)
  const originalRoute = router.route.bind(router);
  router.route = (path: string) => {
    const route = originalRoute(path);
    for (const verb of VERBS) {
      const originalVerb = (route[verb] as (...a: unknown[]) => unknown).bind(route);
      (route as unknown as Record<string, unknown>)[verb] = (...handlers: unknown[]) => {
        routes.push(mkRecord(verb, path, handlers));
        return originalVerb(...handlers);
      };
    }
    return route;
  };

  return router;
}

/** Read the recorded routes off a router produced by {@link Router}. */
export function getRouterRoutes(router: unknown): RouteRecord[] {
  return (router as RecordingRouter | undefined)?.[ROUTER_ROUTES] ?? [];
}
