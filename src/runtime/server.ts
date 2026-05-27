import express, {
  type Application,
  type RequestHandler,
} from 'express';
import cors from 'cors';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import serverConfig from '../configs/server.config.js';
import {
  getRouterRoutes,
  type RouteRecord,
} from '../rest/openapi.js';

/**
 * The Express app keeps a reference to the wrapping Node HTTP server so the
 * sockets loader (and anything else that needs to attach to `upgrade`) can
 * pull it from `(server as any)[HTTP_SERVER]`. We use a symbol rather than
 * an extra cradle entry to avoid widening the public API for what is an
 * implementation detail of the runtime; consumers go through `socketBus`
 * (REST handlers never need the raw server).
 */
export const HTTP_SERVER = Symbol.for('xenosis.httpServer');

/** App-level registry of every route mounted via `server.use(prefix, router)`. */
export const OPENAPI_REGISTRY = Symbol.for('xenosis.openapiRegistry');

interface OpenapiRoute extends RouteRecord {
  /** Full path = mount prefix + router-relative path. */
  fullPath: string;
}

/** Join a `server.use` prefix with a router-relative path into one clean path. */
function joinPaths(prefix: string, path: string): string {
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const b = path.startsWith('/') ? path : `/${path}`;
  const joined = `${a}${b}`;
  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
}

type ServerOptions = {
  /** e.g. "1mb" or a number in bytes */
  bodySizeLimit?: string | number;
};

type ProviderDeps = Pick<any, 'config'>;

const createCorsOriginValidator = (config: any) => {
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
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    const isAllowed = allowedOrigins.some((pattern: string) => {
      if (pattern.startsWith('/^') && pattern.endsWith('$/')) {
        const regex = new RegExp(pattern.slice(1, -1));
        return regex.test(origin);
      } else {
        return pattern === origin;
      }
    });

    if (isAllowed) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'), false);
  };
};

/**
 * Builds the Express application with baseline middleware:
 * CORS + body parsers. The request-context middleware (trace + per-request
 * logger + awilix scope) is wired by xenosisBootstrap AFTER the container is
 * fully built, so it has access to the container itself.
 */
const serverProvider = ({ config }: ProviderDeps): Application => {
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

  const server = express();

  // Harvest routes for OpenAPI: when a controller mounts a recording Router via
  // `server.use(prefix, router)`, copy its recorded routes into an app-level
  // registry with the prefix applied. Falls through untouched for plain `use`.
  const registry: OpenapiRoute[] = [];
  (server as unknown as Record<symbol, OpenapiRoute[]>)[OPENAPI_REGISTRY] = registry;
  const originalUse = server.use.bind(server);
  (server as { use: unknown }).use = (...args: unknown[]) => {
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
    server.use(mw);
  }

  // Wrap Express in a Node HTTP server so the sockets loader (and anything
  // else that needs to attach to `upgrade`) has a stable handle to use. The
  // `commands.start()` step will reuse this server instead of creating a
  // fresh one — see runtime/commands.ts.
  const httpServer: HttpServer = createHttpServer(server);
  (server as unknown as Record<symbol, HttpServer>)[HTTP_SERVER] = httpServer;

  return server;
};

export default serverProvider;
