/**
 * HttpAdapter — abstracts the underlying web framework so the rest of Xenosis
 * (xenosisBootstrap, peer mounting, OpenAPI registry, sockets, commands) can
 * work without knowing whether the runtime is Express, Hono, or anything else.
 *
 * Two adapters ship today: Express (default) and Hono (opt-in via
 * `config.http.framework = "hono"`). Both implement the same `HttpAdapter`
 * contract, so user code (Handler/Request/Response/Router) is identical.
 */
import express, { type Application, type RequestHandler } from 'express';
import cors from 'cors';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import serverConfig from '../configs/server.config.js';
import { getRouterRoutes, type RouteRecord } from '../rest/openapi.js';
import {
  HTTP_SERVER,
  type XServer,
  type XHandler,
  type XErrorHandler,
  type XReq,
  type XRes,
  type XNext,
} from '../rest/http.js';

/** App-level registry of every route mounted via `server.use(prefix, router)`. */
export const OPENAPI_REGISTRY = Symbol.for('xenosis.openapiRegistry');

export interface OpenapiRoute extends RouteRecord {
  /** Full path = mount prefix + router-relative path. */
  fullPath: string;
}

/**
 * Adapter contract. The shipped Express adapter passes its native `Application`
 * through as `app` (it implements `XServer` structurally). The Hono adapter
 * wraps Hono + @hono/node-server behind the same XServer-shaped facade.
 */
export interface HttpAdapter {
  readonly framework: 'express' | 'hono';
  /** The XServer the rest of the framework writes routes/middleware against. */
  readonly app: XServer;
  /** Underlying node:http.Server — used by the sockets loader for `upgrade`. */
  readonly httpServer: HttpServer;
  /** All routes collected from controllers (for OpenAPI). */
  getRoutes(): OpenapiRoute[];
  /** Mount the global error handler. Must run AFTER controllers. */
  mountErrorHandler(handler: XErrorHandler): void;
  /** Start listening. Resolves once the server is bound. */
  listen(port: number): Promise<void>;
}

/** Adapter-shaped config — `serverOptions` are the only knobs we expose. */
interface AdapterConfig {
  allowedOrigins?: string | string[];
  serverOptions?: { bodySizeLimit?: string | number };
}

type ServerOptions = { bodySizeLimit?: string | number };

const createCorsOriginValidator = (config: AdapterConfig) => {
  const allowedOrigins = (typeof config.allowedOrigins === 'string'
    ? config.allowedOrigins.split(',').map((origin: string) => origin.trim())
    : config.allowedOrigins) ?? [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://localhost:3001',
    'http://localhost:4000',
    'http://localhost:8082',
    'http://localhost:8083',
  ];

  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*')) return callback(null, true);

    const isAllowed = allowedOrigins.some((pattern: string) => {
      if (pattern.startsWith('/^') && pattern.endsWith('$/')) {
        const regex = new RegExp(pattern.slice(1, -1));
        return regex.test(origin);
      }
      return pattern === origin;
    });

    return isAllowed
      ? callback(null, true)
      : callback(new Error('Not allowed by CORS'), false);
  };
};

/** Join a `server.use` prefix with a router-relative path into one clean path. */
function joinPaths(prefix: string, path: string): string {
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const b = path.startsWith('/') ? path : `/${path}`;
  const joined = `${a}${b}`;
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

// ─── Express adapter ────────────────────────────────────────────────────────

/**
 * Build the Express adapter: app + cors/body parsers + route harvesting + an
 * HTTP server wrapping the app for WS upgrade.
 */
export function createExpressAdapter(config: AdapterConfig): HttpAdapter {
  const { bodySizeLimit: limit } = {
    ...(serverConfig as ServerOptions),
    ...(config.serverOptions ?? {}),
  };

  const middlewares: RequestHandler[] = [
    cors({
      origin: createCorsOriginValidator(config),
      credentials: true,
      optionsSuccessStatus: 200,
    }),
    express.json({ limit }),
    express.urlencoded({ limit, extended: true }),
    express.text({ limit }),
  ];

  const app: Application = express();

  // Route harvesting: when a controller calls `server.use(prefix, router)`,
  // read the recorded routes off the framework-agnostic Router and register
  // them on Express directly, keeping a registry copy for OpenAPI.
  const registry: OpenapiRoute[] = [];
  (app as unknown as Record<symbol, OpenapiRoute[]>)[OPENAPI_REGISTRY] = registry;
  const originalUse = app.use.bind(app);
  (app as { use: unknown }).use = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args.length >= 2) {
      const prefix = args[0];
      const consumed: unknown[] = [];
      for (const arg of args.slice(1)) {
        const routes = getRouterRoutes(arg);
        if (routes.length > 0) {
          for (const r of routes) {
            const fullPath = joinPaths(prefix, r.path);
            registry.push({ ...r, fullPath });
            mountExpressRoute(app, r.method, fullPath, r.handlers);
          }
          consumed.push(arg);
        }
      }
      // Anything that wasn't a recording Router is passed through to Express
      // as-is (so plain middleware mounted at a prefix still works).
      const passthrough = args.slice(1).filter((a) => !consumed.includes(a));
      if (passthrough.length > 0) {
        return (originalUse as (...a: unknown[]) => unknown)(prefix, ...passthrough);
      }
      return app;
    }
    return (originalUse as (...a: unknown[]) => unknown)(...args);
  };

  for (const mw of middlewares) {
    app.use(mw);
  }

  // Wrap Express in a Node HTTP server so the sockets loader has a stable
  // handle. `listen()` reuses this server instead of creating a fresh one.
  const httpServer: HttpServer = createHttpServer(app);
  (app as unknown as Record<symbol, HttpServer>)[HTTP_SERVER] = httpServer;

  return {
    framework: 'express',
    app: app as unknown as XServer,
    httpServer,
    getRoutes: () => registry,
    mountErrorHandler: (handler) => {
      // Express recognises error middleware by its 4-arg signature.
      app.use(handler as unknown as RequestHandler);
    },
    listen: (port) =>
      new Promise<void>((resolve, reject) => {
        const onListen = () => {
          httpServer.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          httpServer.removeListener('listening', onListen);
          reject(err);
        };
        httpServer.once('listening', onListen);
        httpServer.once('error', onError);
        httpServer.listen(port);
      }),
  };
}

function mountExpressRoute(
  app: Application,
  method: string,
  fullPath: string,
  handlers: XHandler[],
): void {
  const verb = method.toLowerCase();
  const expressVerb = (app as unknown as Record<string, (...a: unknown[]) => unknown>)[verb];
  if (typeof expressVerb !== 'function') {
    throw new Error(`[xenosis] Express adapter: unsupported method "${method}"`);
  }
  expressVerb.call(app, fullPath, ...(handlers as unknown as RequestHandler[]));
}

// ─── Hono adapter ───────────────────────────────────────────────────────────

/**
 * Build the Hono adapter. `hono` and `@hono/node-server` are optional peer
 * dependencies — installed only when the service opts into Hono via
 * `config.http.framework = "hono"`. We import them dynamically so services
 * that stay on Express never pull Hono into the bundle.
 */
export async function createHonoAdapter(config: AdapterConfig): Promise<HttpAdapter> {
  let HonoMod: typeof import('hono');
  let NodeServerMod: typeof import('@hono/node-server');
  let HonoCorsMod: typeof import('hono/cors');
  try {
    [HonoMod, NodeServerMod, HonoCorsMod] = await Promise.all([
      import('hono'),
      import('@hono/node-server'),
      import('hono/cors'),
    ]);
  } catch (err) {
    throw new Error(
      `[xenosis] http.framework = "hono" requires the 'hono' and '@hono/node-server' packages. ` +
        `Install them in your service:  pnpm add hono @hono/node-server\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const { Hono } = HonoMod;
  const { getRequestListener } = NodeServerMod;
  const { cors: honoCors } = HonoCorsMod;

  type HonoContext = import('hono').Context;
  type HonoApp = import('hono').Hono;
  const hono: HonoApp = new Hono();

  const registry: OpenapiRoute[] = [];

  // CORS — translate our config to Hono's middleware.
  const allowedOrigins =
    (typeof config.allowedOrigins === 'string'
      ? config.allowedOrigins.split(',').map((o) => o.trim())
      : config.allowedOrigins) ?? ['*'];
  hono.use(
    '*',
    honoCors({
      origin: (origin) => {
        if (!origin) return origin ?? '*';
        if (allowedOrigins.includes('*')) return origin;
        return allowedOrigins.includes(origin) ? origin : null;
      },
      credentials: true,
    }),
  );

  // Body parsing is intrinsic to Hono: `c.req.json()` / `c.req.parseBody()` —
  // no separate middleware needed. We surface the parsed body lazily on XReq.

  // The XServer facade we hand to user code. Mirrors the Express app shape
  // (verb methods + use + route + listen) but records into a buffer that we
  // later replay into Hono with the full XReq/XRes glue layer.
  interface PendingMw {
    path?: string;
    handlers: XHandler[];
  }
  interface PendingRoute {
    method: string;
    path: string;
    handlers: XHandler[];
  }

  const globalMw: PendingMw[] = [];
  const errorHandlers: XErrorHandler[] = [];

  const facade = {} as XServer;
  // OpenAPI loader reads routes off this symbol — match the Express adapter.
  (facade as unknown as Record<symbol, OpenapiRoute[]>)[OPENAPI_REGISTRY] = registry;
  const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

  const addRoute = (method: string, path: string, handlers: XHandler[]) => {
    const meta = (handlers[handlers.length - 1] as { [k: symbol]: unknown } | undefined)?.[
      Symbol.for('xenosis.routeMeta')
    ] as OpenapiRoute['meta'] | undefined;
    const record: OpenapiRoute = meta
      ? { method, path, handlers, fullPath: path, meta }
      : { method, path, handlers, fullPath: path };
    registry.push(record);
    mountHonoRoute(hono, method, path, [...globalMw, ...handlers.map((h) => ({ handlers: [h] }))], errorHandlers);
  };

  for (const verb of VERBS) {
    (facade as unknown as Record<string, unknown>)[verb] = (
      path: string,
      ...handlers: XHandler[]
    ) => {
      addRoute(verb, path, handlers);
      return facade;
    };
  }
  (facade as unknown as Record<string, unknown>).all = (
    path: string,
    ...handlers: XHandler[]
  ) => {
    for (const verb of VERBS) addRoute(verb, path, handlers);
    return facade;
  };

  (facade as unknown as Record<string, unknown>).use = (...args: unknown[]) => {
    // Form 1: use('/prefix', router-or-mw, ...)
    if (typeof args[0] === 'string' && args.length >= 2) {
      const prefix = args[0];
      for (const arg of args.slice(1)) {
        const routes = getRouterRoutes(arg);
        if (routes.length > 0) {
          for (const r of routes) {
            const fullPath = joinPaths(prefix, r.path);
            const meta = r.meta;
            const rec: OpenapiRoute = meta
              ? { ...r, fullPath, meta }
              : { method: r.method, path: r.path, handlers: r.handlers, fullPath };
            registry.push(rec);
            mountHonoRoute(
              hono,
              r.method,
              fullPath,
              [...globalMw, ...r.handlers.map((h) => ({ handlers: [h] }))],
              errorHandlers,
            );
          }
        } else if (typeof arg === 'function') {
          globalMw.push({ path: prefix, handlers: [arg as XHandler] });
        }
      }
      return facade;
    }
    // Form 2: use(mw, mw2, …)
    for (const arg of args) {
      if (typeof arg === 'function') {
        globalMw.push({ handlers: [arg as XHandler] });
      }
    }
    return facade;
  };

  (facade as unknown as Record<string, unknown>).route = () => {
    throw new Error(
      "[xenosis] facade.route() is not supported on the server itself — use the recording Router() from @xenosisorg/xenosis-core.",
    );
  };

  (facade as unknown as Record<string, unknown>).listen = (port: number, cb?: () => void) => {
    // Hono uses serve(); listen() on the facade is a back-compat shim. Real
    // listen happens through adapter.listen(port).
    if (cb) cb();
    return undefined;
  };

  // node:http.Server that runs Hono's `fetch` via @hono/node-server's
  // getRequestListener bridge. Created up front so the sockets loader can
  // attach `upgrade` before listen(). listen() is delegated to this server.
  const honoListener = getRequestListener(hono.fetch);
  const httpServer = createHttpServer(honoListener as never);
  (facade as unknown as Record<symbol, HttpServer>)[HTTP_SERVER] = httpServer;

  return {
    framework: 'hono',
    app: facade,
    httpServer,
    getRoutes: () => registry,
    mountErrorHandler: (handler) => {
      errorHandlers.push(handler);
      hono.onError((err, c) => {
        // Wrap Hono's error into XErrorHandler signature.
        const { req: xreq, res: xres } = makeXReqRes(c);
        let resolved = false;
        const next = (_err?: unknown) => {
          resolved = true;
        };
        try {
          handler(err, xreq, xres, next);
        } catch (e) {
          // Fall through to default Hono error response below.
        }
        if (resolved) return finalize(c, xres);
        return finalize(c, xres);
      });
    },
    listen: (port) =>
      new Promise<void>((resolve, reject) => {
        const onListen = () => {
          httpServer.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          httpServer.removeListener('listening', onListen);
          reject(err);
        };
        httpServer.once('listening', onListen);
        httpServer.once('error', onError);
        httpServer.listen(port);
      }),
  };
}

// ─── Hono ⇄ X glue ──────────────────────────────────────────────────────────

interface XResState {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  bodySent: boolean;
  finishListeners: Array<() => void>;
}

function makeXReqRes(c: import('hono').Context): { req: XReq; res: XRes } {
  const honoReq = c.req;
  const url = new URL(honoReq.url);

  // Lazy body — Hono parses on demand. We do a best-effort sync exposure by
  // pre-parsing in mountHonoRoute below; here we just type the slot.
  const headers: Record<string, string | string[] | undefined> = {};
  honoReq.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const queryObj: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    if (k in queryObj) {
      const prev = queryObj[k];
      queryObj[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      queryObj[k] = v;
    }
  });

  const xreq: XReq = {
    method: honoReq.method,
    path: url.pathname,
    url: honoReq.url,
    headers,
    query: queryObj,
    params: honoReq.param() as Record<string, string>,
    body: undefined,
    header: (name) => {
      const v = honoReq.header(name);
      return typeof v === 'string' ? v : undefined;
    },
    raw: c,
  };

  const state: XResState = {
    statusCode: 200,
    headers: {},
    body: undefined,
    bodySent: false,
    finishListeners: [],
  };

  const xres: XRes = {
    get statusCode() {
      return state.statusCode;
    },
    get headersSent() {
      return state.bodySent;
    },
    status(code) {
      state.statusCode = code;
      return xres;
    },
    setHeader(name, value) {
      state.headers[name.toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : String(value);
      return xres;
    },
    getHeader(name) {
      return state.headers[name.toLowerCase()];
    },
    json(body) {
      state.body = body;
      state.headers['content-type'] ??= 'application/json; charset=utf-8';
      state.bodySent = true;
      return xres;
    },
    send(body) {
      state.body = body;
      state.bodySent = true;
      return xres;
    },
    end(body) {
      if (body !== undefined) state.body = body;
      state.bodySent = true;
      return xres;
    },
    on(event, listener) {
      if (event === 'finish' || event === 'close') {
        state.finishListeners.push(listener);
      }
      return xres;
    },
    raw: c,
  };

  // Carry state on the response object so finalize() can read it without a
  // weak map lookup.
  (xres as unknown as Record<symbol, XResState>)[X_RES_STATE] = state;

  return { req: xreq, res: xres };
}

const X_RES_STATE = Symbol.for('xenosis.xResState');

/** Read the state slot off an XRes built by makeXReqRes; throws if absent. */
function getXResState(xres: XRes): XResState {
  const state = (xres as unknown as Record<symbol, XResState | undefined>)[X_RES_STATE];
  if (!state) {
    throw new Error('[xenosis/hono] XRes is missing its internal state slot');
  }
  return state;
}

function finalize(c: import('hono').Context, xres: XRes): Response {
  const state = getXResState(xres);
  // Fire `finish` listeners synchronously after the body is built.
  for (const fn of state.finishListeners) {
    try {
      fn();
    } catch {
      // ignore listener errors — match Node http.Server semantics
    }
  }
  for (const [k, v] of Object.entries(state.headers)) {
    c.header(k, v);
  }
  const status = state.statusCode as 200;
  if (state.body === undefined || state.body === null) {
    return c.body(null, status);
  }
  const ct = state.headers['content-type'] ?? '';
  if (ct.includes('application/json')) {
    return c.json(state.body, status);
  }
  if (typeof state.body === 'string' || state.body instanceof Uint8Array) {
    return c.body(state.body as never, status);
  }
  // Fall back to JSON for objects without an explicit content-type.
  return c.json(state.body, status);
}

interface MwSlot {
  path?: string;
  handlers: XHandler[];
}

function mountHonoRoute(
  hono: import('hono').Hono,
  method: string,
  fullPath: string,
  mwChain: MwSlot[],
  errorHandlers: XErrorHandler[],
): void {
  const verb = method.toLowerCase() as Lowercase<
    'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'
  >;

  const honoHandler = async (c: import('hono').Context): Promise<Response> => {
    // Pre-parse body once for the request lifetime. Hono parses on demand;
    // we eagerly read so XReq.body is populated like Express's express.json().
    let body: unknown = undefined;
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        body = await c.req.json();
      } catch {
        body = undefined;
      }
    } else if (
      ct.includes('application/x-www-form-urlencoded') ||
      ct.includes('multipart/form-data')
    ) {
      try {
        body = await c.req.parseBody();
      } catch {
        body = undefined;
      }
    } else if (ct.startsWith('text/')) {
      try {
        body = await c.req.text();
      } catch {
        body = undefined;
      }
    }

    const { req: xreq, res: xres } = makeXReqRes(c);
    xreq.body = body;

    // Walk the middleware chain + final handlers, honouring next(err) by
    // jumping to the error handler chain.
    const slots = mwChain;
    let lastError: unknown = undefined;
    for (const slot of slots) {
      if (slot.path && !pathMatches(slot.path, xreq.path)) continue;
      for (const handler of slot.handlers) {
        let advanced = false;
        let errFromNext: unknown = undefined;
        const next: XNext = (err) => {
          advanced = true;
          if (err !== undefined) errFromNext = err;
        };
        try {
          const result = handler(xreq, xres, next);
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            await result;
          }
        } catch (err) {
          errFromNext = err;
          advanced = true;
        }
        if (errFromNext !== undefined) {
          lastError = errFromNext;
          break;
        }
        // If the handler resolved a response synchronously (via Response.apply
        // → xres.send/json) and didn't call next, we stop walking.
        const state = getXResState(xres);
        if (state.bodySent && !advanced) {
          return finalize(c, xres);
        }
      }
      if (lastError !== undefined) break;
    }

    if (lastError !== undefined) {
      // Run the registered error handlers; whichever sets a body wins.
      for (const eh of errorHandlers) {
        let advanced = false;
        const next: XNext = () => {
          advanced = true;
        };
        try {
          const r = eh(lastError, xreq, xres, next);
          if (r && typeof (r as Promise<unknown>).then === 'function') {
            await r;
          }
        } catch {
          // error handlers should not throw; if one does, fall through
        }
        const state = getXResState(xres);
        if (state.bodySent) break;
        if (!advanced) break;
      }
      const state = getXResState(xres);
      if (!state.bodySent) {
        xres.status(500).json({ error: 'InternalServerError' });
      }
      return finalize(c, xres);
    }

    const state = getXResState(xres);
    if (!state.bodySent) {
      // No handler produced a response — match Express's default 404.
      xres.status(404).end();
    }
    return finalize(c, xres);
  };

  // Express treats `/x` and `/x/` as equivalent. Hono doesn't, so we mount
  // both paths against the same handler (skip when there's only one form, e.g. "/").
  const paths = fullPath === '/' || fullPath.endsWith('/')
    ? [fullPath]
    : [fullPath, `${fullPath}/`];

  for (const p of paths) {
    switch (verb) {
      case 'get':
        hono.get(p, honoHandler);
        break;
      case 'post':
        hono.post(p, honoHandler);
        break;
      case 'put':
        hono.put(p, honoHandler);
        break;
      case 'patch':
        hono.patch(p, honoHandler);
        break;
      case 'delete':
        hono.delete(p, honoHandler);
        break;
      case 'options':
        hono.options(p, honoHandler);
        break;
      case 'head':
        // Hono v4 doesn't expose .head explicitly; mount as a generic route.
        hono.on('HEAD', p, honoHandler);
        break;
    }
  }
}

/** Express-style prefix match: `/api` matches `/api`, `/api/x` but not `/apinot`. */
function pathMatches(prefix: string, fullPath: string): boolean {
  if (prefix === '/' || prefix === '') return true;
  const normPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return fullPath === normPrefix || fullPath.startsWith(`${normPrefix}/`);
}
