import { ROUTE_META, type RouteMeta } from './Handler';
import type { XHandler, XRouter, XRouterRoute } from './http';

/**
 * One captured route: HTTP method, the path RELATIVE to the router (the prefix
 * from `server.use(prefix, router)` is joined later by the adapter), the
 * handler chain (zero or more middleware + the final handler), and metadata
 * harvested from the final `Handler(...)` selector for OpenAPI.
 */
export interface RouteRecord {
  method: string;
  path: string;
  handlers: XHandler[];
  meta?: RouteMeta;
}

export const ROUTER_ROUTES = Symbol.for('xenosis.routerRoutes');

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
type Verb = (typeof VERBS)[number];

interface RecordingRouter extends XRouter {
  [ROUTER_ROUTES]: RouteRecord[];
}

/** Pull RouteMeta off the last handler in a verb call, if present. */
function metaFromHandlers(handlers: XHandler[]): RouteMeta | undefined {
  const last = handlers[handlers.length - 1] as
    | { [ROUTE_META]?: RouteMeta }
    | undefined;
  return last?.[ROUTE_META];
}

function mkRecord(method: string, path: string, handlers: XHandler[]): RouteRecord {
  const meta = metaFromHandlers(handlers);
  return meta ? { method, path, handlers, meta } : { method, path, handlers };
}

/**
 * Framework-agnostic recording router. Captures every route mounted on it into
 * a hidden `[ROUTER_ROUTES]` array. The HTTP adapter reads these records when
 * the router is passed to `server.use(prefix, router)` and registers them with
 * the underlying framework (Express, Hono, …).
 *
 * Supports both styles:
 *   router.route('/x').get(Handler(...))
 *   router.get('/x', Handler(...))
 */
export function Router(): XRouter {
  const routes: RouteRecord[] = [];

  const router = {
    [ROUTER_ROUTES]: routes,
  } as RecordingRouter;

  const addVerb = (verb: Verb | 'all') => (path: string, ...handlers: XHandler[]) => {
    routes.push(mkRecord(verb, path, handlers));
    return router;
  };

  for (const verb of VERBS) {
    (router as unknown as Record<string, unknown>)[verb] = addVerb(verb);
  }
  (router as unknown as Record<string, unknown>).all = addVerb('all');

  // `use` on a recording router is a no-op for the framework — global
  // middleware on a sub-router has no meaningful translation when each route
  // is later re-registered by the adapter. Controllers don't actually use
  // `router.use(...)` in practice; if needed, mount middleware at the verb
  // level (e.g. `router.get('/x', authMw, Handler(...))`).
  (router as unknown as Record<string, unknown>).use = (..._args: unknown[]) => router;

  (router as unknown as Record<string, unknown>).route = (path: string): XRouterRoute => {
    const routeObj = {} as XRouterRoute;
    for (const verb of VERBS) {
      (routeObj as unknown as Record<string, unknown>)[verb] = (
        ...handlers: XHandler[]
      ) => {
        routes.push(mkRecord(verb, path, handlers));
        return routeObj;
      };
    }
    return routeObj;
  };

  return router;
}

/** Read the recorded routes off a router produced by {@link Router}. */
export function getRouterRoutes(router: unknown): RouteRecord[] {
  return (router as RecordingRouter | undefined)?.[ROUTER_ROUTES] ?? [];
}
