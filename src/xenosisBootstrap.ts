import {
  asClass,
  asFunction,
  asValue,
  createContainer,
  AwilixContainer,
} from 'awilix';

import { errorHandlerMiddleware } from './middlewares/errorHandler.middleware';

import { Commands } from './runtime/commands';
import { Signals } from './runtime/signals';
import Server from './runtime/server';
import DynamicImport from './core/dynamicImport';
import configProvider from './core/config';
import loggerProvider from './core/logger';
import PrismaProvider from './connectors/prisma';
import RedisProvider from './connectors/redis';
import MysqlProvider from './connectors/mysql';
import MongoProvider from './connectors/mongo';
import DynamoProvider from './connectors/dynamo';
import KafkaProvider from './connectors/kafka';
import EtcdProvider from './connectors/etcd';
import { loadSchemas } from './libs/schemas.loader';
import { validateConfig } from './libs/config.loader';
import { runAutoload } from './libs/autoload.loader';
import { loadSharedModules } from './libs/sharedModules.loader';
import { loadPeers } from './peers/loader';
import { loadServiceApis } from './peers/servicesLoader';
import { loadSockets } from './sockets/loader';
import { buildRequestContextMiddleware } from './middlewares/requestContext.middleware';
import { mountOpenapi } from './libs/openapi.loader';
import type { AutoloadOptions } from './types';

export let rootContainer: AwilixContainer;

/**
 * Creates a new microservice instance with an awilix container.
 *
 * Two patterns coexist:
 *  1. Single-schema fallback — single-service apps can use `connectors.{prisma|redis|mysql|mongo|dynamo|kafka|etcd}`
 *     directly; the legacy providers are registered for backward compatibility.
 *  2. Multi-schema (recommended for multi-service monorepos) — declare `schemas.{cradleKey}`
 *     bindings that reference a SchemaPackage and a connector. Each binding becomes
 *     a cradle entry with the runtime client returned by `schemaPackage.createClient(connector)`.
 *     See SCHEMAS.md for the package convention.
 *
 * Optional autoload: pass `autoload` to glob-discover user-land files and register
 * them in the container without manual `container.register(...)` calls.
 * See AUTOLOAD.md for the convention.
 */
export async function xenosisBootstrap(
  options: {
    container?: AwilixContainer;
    autoload?: AutoloadOptions;
  } = {},
): Promise<AwilixContainer> {
  const container = options.container || createContainer();
  rootContainer = container;

  container.register({
    logger: asFunction(loggerProvider).singleton(),
    context: asValue({}),
    errorHandlerMiddleware: asValue(errorHandlerMiddleware),
    config: asFunction(configProvider).singleton(),
    server: asFunction(Server).singleton(),
    signals: asClass(Signals).singleton(),
    commands: asClass(Commands).singleton(),
    dynamicImport: asFunction(DynamicImport),
    // Single-schema fallback providers. Lazy: instantiated only on cradle access.
    prisma: asFunction(PrismaProvider).singleton(),
    redis: asFunction(RedisProvider).singleton(),
    mysql: asFunction(MysqlProvider).singleton(),
    mongo: asFunction(MongoProvider).singleton(),
    dynamo: asFunction(DynamoProvider).singleton(),
    kafka: asFunction(KafkaProvider).singleton(),
    etcd: asFunction(EtcdProvider).singleton(),
  });

  // Validate config FIRST — before the logger is built — so the validated,
  // env-resolved config (e.g. NODE_ENV → env) drives logger format. The logger
  // depends on config, so config can't depend on the logger here.
  const rawConfig = container.cradle.config;
  const config = await validateConfig(rawConfig);
  container.register({ config: asValue(config) });

  // Now the logger picks up the validated config (singleton, built on first use).
  const logger = container.cradle.logger;

  // Multi-schema bindings — eager so failures surface at boot, not first query.
  await loadSchemas(container, config, logger);

  // Peer bindings — type-safe RPC clients from config.peers
  await loadPeers(container, config, logger);

  // Service-API aggregator — same bindings exposed under cradle.api so callers
  // can write `this.api.users.createUser(...)` against the peer service's own
  // exported routes (defineServiceApi). Lives next to loadPeers; either pattern
  // works against the same config.peers entries.
  await loadServiceApis(container, config, logger);

  // Shared modules — workspace-wide singletons (whitelabel, feature flags, …)
  // Listed in xenosis.workspace.json → sharedModules. Loaded BEFORE autoload so
  // user-land services / repositories can inject them through their constructor.
  await loadSharedModules(container, logger);

  // Mount the per-request middleware FIRST (before any user routes get attached
  // via autoload). It creates a per-request awilix scope and an AsyncLocalStorage
  // bag carrying the active trace + child logger.
  const server = container.cradle.server;
  server.use(buildRequestContextMiddleware(container, logger, config));

  // Autoload user-land repositories/services/controllers if requested.
  // Runs after schemas + peers + shared modules so user code can inject anything.
  if (options.autoload) {
    await runAutoload(container, options.autoload, logger);
  }

  // Sockets — wired after autoload so socket handlers (autoloaded as
  // `<name>Socket` cradle entries) are resolvable. Always registers a
  // `socketBus` cradle entry; when no `config.sockets` binding exists the
  // bus is a no-op so consumers can depend on it unconditionally. Its
  // disconnects join the lifecycle stack via the `socketDisconnects`
  // cradle key (Commands picks it up below).
  const { disconnects: socketDisconnects } = await loadSockets(container, config, logger);
  container.register({ socketDisconnects: asValue(socketDisconnects) });

  // OpenAPI: now that every controller has mounted its routes, the server's
  // route registry is complete. Mount /openapi.json + Swagger UI unless the
  // service opted out via config.openapi.enabled === false. Must run before
  // commands.start() (which appends the error-handler middleware).
  if (config.openapi?.enabled !== false) {
    // config is validated; spread is exactOptional-safe at runtime.
    const { jsonPath, uiPath } = mountOpenapi(server, {
      ...(config.openapi ?? {}),
      name: config.name,
    } as Parameters<typeof mountOpenapi>[1]);
    logger.info(`📖 OpenAPI: spec at ${jsonPath}, Swagger UI at ${uiPath}`);
  }

  return container;
}
