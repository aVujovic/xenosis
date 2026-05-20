import express, {
  type Application,
  type RequestHandler,
} from 'express';
import cors from 'cors';
import serverConfig from '../configs/server.config.js';

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

  for (const mw of middlewares) {
    server.use(mw);
  }

  return server;
};

export default serverProvider;
