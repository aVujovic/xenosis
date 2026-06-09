/**
 * HttpAdapter — abstracts the underlying web framework so the rest of Xenosis
 * (xenosisBootstrap, peer mounting, OpenAPI registry, sockets, commands) can
 * work without knowing whether the runtime is Express, Hono, or anything else.
 *
 * The shipped adapter is Express (`createExpressAdapter`). Phase 3 will add a
 * Hono adapter; both implement the same interface so the choice is a single
 * `http.framework: 'express' | 'hono'` config switch.
 */
import express, { type Application, type RequestHandler } from 'express';
import cors from 'cors';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import serverConfig from '../configs/server.config.js';
import { getRouterRoutes, type RouteRecord } from '../rest/openapi.js';
import { HTTP_SERVER, type XServer, type XHandler, type XErrorHandler } from '../rest/http.js';

/** App-level registry of every route mounted via `server.use(prefix, router)`. */
export const OPENAPI_REGISTRY = Symbol.for('xenosis.openapiRegistry');

export interface OpenapiRoute extends RouteRecord {
  /** Full path = mount prefix + router-relative path. */
  fullPath: string;
}

/**
 * Adapter contract. The shipped Express adapter passes its native `Application`
 * through as `app` (it implements `XServer` structurally). A future Hono
 * adapter would wrap Hono's app + @hono/node-server.
 */
export interface HttpAdapter {
  /** The XServer the rest of the framework writes routes/middleware against. */
  readonly app: XServer;
  /** Underlying node:http.Server — used by the sockets loader for `upgrade`. */
  readonly httpServer: HttpServer;
  /** All routes collected from controllers (for OpenAPI). */
  getRoutes(): OpenapiRoute[];
  /** Mount the global error handler. Must run AFTER controllers. */
  mountErrorHandler(handler: XErrorHandler): void;
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

/**
 * Build the Express adapter: app + cors/body parsers + route harvesting + an
 * HTTP server wrapping the app for WS upgrade. Phase 3 will add the Hono
 * counterpart that fulfils the same `HttpAdapter` contract.
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

  // Route harvesting: when a controller mounts a recording Router via
  // `server.use(prefix, router)`, copy its recorded routes into an app-level
  // registry with the prefix applied. Falls through untouched for plain `use`.
  const registry: OpenapiRoute[] = [];
  (app as unknown as Record<symbol, OpenapiRoute[]>)[OPENAPI_REGISTRY] = registry;
  const originalUse = app.use.bind(app);
  (app as { use: unknown }).use = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args.length >= 2) {
      const prefix = args[0];
      for (const arg of args.slice(1)) {
        for (const r of getRouterRoutes(arg)) {
          registry.push({ ...r, fullPath: joinPaths(prefix, r.path) });
        }
      }
    }
    return (originalUse as (...a: unknown[]) => unknown)(...args);
  };

  for (const mw of middlewares) {
    app.use(mw);
  }

  // Wrap Express in a Node HTTP server so the sockets loader has a stable
  // handle. `commands.start()` reuses this server instead of creating a fresh one.
  const httpServer: HttpServer = createHttpServer(app);
  (app as unknown as Record<symbol, HttpServer>)[HTTP_SERVER] = httpServer;

  return {
    app: app as unknown as XServer,
    httpServer,
    getRoutes: () => registry,
    mountErrorHandler: (handler) => {
      // Express recognises error middleware by its 4-arg signature.
      app.use(handler as unknown as RequestHandler);
    },
  };
}
