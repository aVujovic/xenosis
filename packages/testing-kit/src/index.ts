import { createContainer, asValue, asFunction, type AwilixContainer } from 'awilix';
import {
  loggerProvider,
  serverProvider,
  loadSharedModules,
  runAutoload,
  loadServiceApis,
  mountOpenapi,
  buildRequestContextMiddleware,
  errorHandlerMiddleware,
  type SchemaPackage,
  type AutoloadOptions,
} from '@xenosisorg/xenosis-core';
import { join } from 'node:path';
import type { PeerApi, PeerClient } from '@xenosisorg/xenosis-core';
import { replayPrismaMigrations } from './migrate';
import { resolveTestConfig } from './config';
import { createInProcessClient } from './inProcessClient';

export { replayPrismaMigrations } from './migrate';
export { resolveTestConfig } from './config';
export { createInProcessClient } from './inProcessClient';

/** A schema binding for the test container: the package + its cradle key. */
export interface TestSchema {
  /** Cradle key the service injects (e.g. `mainDb`). */
  cradleKey: string;
  /** The schema package module (default export or `{ createTestClient, schema }`). */
  pkg: SchemaPackage;
  /** Connector this binding would use in prod — only `type` matters for test dispatch. */
  connector?: { type: string } & Record<string, unknown>;
}

export interface CreateTestContainerOptions {
  /**
   * Auto mode. Point at a service directory and the kit does the rest:
   *   - reads `xenosis.config.json` layered with `__tests__/test.config.json`
   *   - boots an in-memory engine for each `config.schemas` binding, importing
   *     the package by its npm name and replaying its migrations
   *   - autoloads repositories/services/controllers by the standard convention
   * Override any piece with the explicit options below.
   */
  serviceRoot?: string;
  /**
   * The service config object. In `serviceRoot` mode this is the resolved
   * config and is usually omitted; pass it to fully override. The schemas block
   * drives in-memory engine setup.
   */
  config?: Record<string, unknown>;
  /** Schema packages to back with an in-memory engine (explicit mode). */
  schemas?: TestSchema[];
  /**
   * Peer mocks. Each key becomes both `cradle.<name>` and `cradle.api.<name>`,
   * so a service can inject either `this.api.billing` or `billing` directly.
   */
  peers?: Record<string, Record<string, (...args: any[]) => unknown>>;
  /**
   * Autoload globs. Defaults (serviceRoot mode) to the standard convention
   * rooted at serviceRoot: repository/*.repository, services/*.service,
   * api/**\/*.controller.
   */
  autoload?: AutoloadOptions;
  /** Extra cradle registrations (asValue) applied before autoload. */
  register?: Record<string, unknown>;
  /**
   * Seed callback run after schema clients are ready and before the proof
   * query. Receives the cradle so you can write rows via `cradle.<schemaKey>`.
   */
  seed?: (cradle: any) => Promise<void> | void;
}

export interface TestContainer {
  container: AwilixContainer;
  /** The awilix cradle — read clients/services off it. */
  cradle: any;
  /** The live Express app — pass to supertest(app) without listening. */
  server: any;
  /**
   * Build a type-safe client for an API contract, routed at the in-process app.
   * Calls go through the same Proxy + zod + path-param machinery production
   * callers use — but hit `server` directly, no port. Use it to exercise a
   * service through its own `defineServiceApi` contract:
   *
   *   const billing = ctx.client(billingApi);
   *   const charge = await billing.createCharge({ userId, amount, currency });
   */
  client: <TApi extends Record<string, (...args: any[]) => Promise<any>>>(
    api: PeerApi<TApi>,
  ) => PeerClient<TApi>;
  /**
   * Open a WebSocket client against an in-process socket API. The harness
   * starts the http server on an ephemeral port the first time you call
   * this; subsequent calls reuse the same port. Returns a tiny client
   * with `.send`, `.subscribe`, `.received`, `.waitFor`, `.close`.
   *
   *   const alice = await ctx.socket('chat').connect({ token: 'jwt-alice' });
   *   alice.subscribe('room:r1');
   *   alice.send('sendMessage', { roomId: 'r1', text: 'hi' });
   *   await alice.waitFor(1);   // wait for one broadcast
   *
   * `name` matches the binding key in `config.sockets`; the harness reads
   * the resolved path off the SocketApi the loader registered.
   */
  socket: (name: string) => import('./socketTestClient').SocketTestServer | Promise<import('./socketTestClient').SocketTestServer>;
  /** Tear down in-memory engines and clients. Call in afterAll/afterEach. */
  cleanup: () => Promise<void>;
}

/**
 * Boot a Xenosis service in-process for tests: real schema on an in-memory
 * Postgres (PGlite), real controllers, peer calls replaced by mocks. No Docker,
 * no network, no migrations CLI — the kit replays the package's migration SQL
 * onto a fresh PGlite, then the package wraps it in its own Prisma client via
 * `createTestClient`.
 *
 * This intentionally re-implements the xenosisBootstrap sequence (rather than
 * calling it) so it can swap the schema layer for in-memory engines — bootstrap
 * always builds the real connector clients.
 */
export async function createTestContainer(
  options: CreateTestContainerOptions = {},
): Promise<TestContainer> {
  const cleanups: Array<() => Promise<void> | void> = [];

  // serviceRoot mode: derive config, schemas, and autoload from the service dir.
  let config = options.config ?? {};
  let schemas = options.schemas ?? [];
  let autoload = options.autoload;

  if (options.serviceRoot) {
    const root = options.serviceRoot;
    if (!options.config) config = await resolveTestConfig(root);

    // Import each config.schemas binding by package name → TestSchema.
    if (!options.schemas) {
      const cfgSchemas = (config as any).schemas ?? {};
      const cfgConnectors = (config as any).connectors ?? {};
      const derived: TestSchema[] = [];
      for (const [cradleKey, binding] of Object.entries<any>(cfgSchemas)) {
        const mod: any = await import(binding.package);
        const pkg: SchemaPackage =
          typeof mod.createClient === 'function' ? mod : mod.default;
        const connector = cfgConnectors[binding.connector] ?? { type: pkg.schema.type };
        derived.push({ cradleKey, pkg, connector });
      }
      schemas = derived;
    }

    // Default autoload: standard convention rooted at serviceRoot (absolute
    // globs so it works regardless of process.cwd()).
    if (!options.autoload) {
      autoload = {
        repositories: { pattern: join(root, 'src/repository/*.repository.{ts,js}'), lifetime: 'singleton' },
        services: { pattern: join(root, 'src/services/*.service.{ts,js}'), lifetime: 'singleton' },
        controllers: { pattern: join(root, 'src/api/**/*.controller.{ts,js}'), style: 'build' },
      } as AutoloadOptions;
    }
  }

  const container = createContainer();

  // Core singletons. config is injected as a value (no disk/env read).
  container.register({
    config: asValue(config),
    logger: asFunction(loggerProvider).singleton(),
    context: asValue({}),
    errorHandlerMiddleware: asValue(errorHandlerMiddleware),
    server: asFunction(serverProvider).singleton(),
    // Disconnect arrays the loaders/commands expect to exist.
    schemaDisconnects: asValue([]),
    peerDisconnects: asValue([]),
  });

  const logger = container.cradle.logger;

  // 1. Schemas → in-memory engine. Dispatch on connector.type.
  for (const s of schemas) {
    const type = s.connector?.type ?? s.pkg.schema.type;
    if (type === 'postgres' || type === 'prisma') {
      if (typeof s.pkg.createTestClient !== 'function') {
        throw new Error(
          `[testing] schema "${s.cradleKey}": package has no createTestClient — ` +
            `add it to support in-memory tests (see @xenosisorg/xenosis-testing docs)`,
        );
      }
      // Lazy import so PGlite stays an optional peer dep.
      const { PGlite } = await import('@electric-sql/pglite');
      const pglite = new PGlite();
      await pglite.waitReady;

      if (s.pkg.schema.migrationsPath) {
        await replayPrismaMigrations(s.pkg.schema.migrationsPath, (sql) =>
          pglite.exec(sql),
        );
      }

      const client = await s.pkg.createTestClient!(pglite, s.connector ?? { type });
      container.register({ [s.cradleKey]: asValue(client) });

      cleanups.push(async () => {
        if (typeof s.pkg.disconnect === 'function') await s.pkg.disconnect(client);
        await pglite.close();
      });
    } else {
      throw new Error(
        `[testing] schema "${s.cradleKey}": in-memory engine for type "${type}" ` +
          `is not implemented yet (prototype supports postgres/prisma)`,
      );
    }
  }

  // 2. Peer mocks — register under both `<name>` and the `api` aggregator.
  const api: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(options.peers ?? {})) {
    container.register({ [name]: asValue(impl) });
    api[name] = impl;
  }
  // Merge any real service-api aggregator the config wants, then override.
  await loadServiceApis(container, { ...config, peers: undefined }, logger).catch(() => {});
  container.register({ api: asValue(api) });

  // 3. Extra registrations.
  for (const [k, v] of Object.entries(options.register ?? {})) {
    container.register({ [k]: asValue(v) });
  }

  // 4. Shared modules + request middleware + autoload + openapi (bootstrap order).
  await loadSharedModules(container, logger).catch(() => {});

  const server = container.cradle.server;
  server.use(buildRequestContextMiddleware(container, logger, config));

  if (autoload) {
    await runAutoload(container, autoload, logger);
  }

  if ((config as any).openapi?.enabled !== false) {
    try {
      mountOpenapi(server, { ...(config as any).openapi, name: (config as any).name });
    } catch {
      /* openapi is best-effort in tests */
    }
  }

  // Error handler last, mirroring commands.start() in production.
  server.use(errorHandlerMiddleware);

  // Seed the in-memory DB once everything is registered.
  if (options.seed) {
    await options.seed(container.cradle);
  }

  // Lazy socket test factory: created on first `ctx.socket(name)` call so
  // tests that don't touch WebSockets pay no listener cost. Lookup the
  // resolved SocketApi off `container.cradle.<name>Socket` — autoload puts
  // the handler instance there; we read its constructor's metadata or fall
  // back to scanning `config.sockets[name].path`.
  let socketTestServer: Awaited<ReturnType<typeof import('./socketTestClient').createSocketTestServer>> | undefined;
  const socketFactory = async (name: string) => {
    if (socketTestServer) return socketTestServer;
    const { HTTP_SERVER } = await import('@xenosisorg/xenosis-core');
    const httpServer = (server as Record<symbol, import('node:http').Server | undefined>)[
      HTTP_SERVER as symbol
    ];
    if (!httpServer) {
      throw new Error(
        '[xenosis-testing] ctx.socket(): no http.Server attached to the Express app — ' +
          'this usually means the test bypassed serverProvider. Boot the test container via createTestContainer.',
      );
    }
    const binding = (container.cradle.config as { sockets?: Record<string, { path?: string }> }).sockets?.[name];
    if (!binding) {
      throw new Error(
        `[xenosis-testing] ctx.socket('${name}'): no binding found in config.sockets. ` +
          `Available: ${Object.keys((container.cradle.config as { sockets?: object }).sockets ?? {}).join(', ') || '(none)'}`,
      );
    }
    // The path on the binding wins if set; otherwise we trust the loader
    // to have used the SocketApi.path. We can't reach the SocketApi from
    // here without re-importing the package — the path override is the
    // common case for tests, so accept both routes:
    const path = binding.path ?? `/ws/${name}`;
    const { createSocketTestServer } = await import('./socketTestClient');
    socketTestServer = await createSocketTestServer(httpServer, path);
    cleanups.push(async () => { await socketTestServer?.close(); socketTestServer = undefined; });
    return socketTestServer;
  };

  return {
    container,
    cradle: container.cradle,
    server,
    client: (api) => createInProcessClient(server, api),
    socket: socketFactory,
    cleanup: async () => {
      for (const c of cleanups.reverse()) await c();
    },
  };
}
