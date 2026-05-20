import { AwilixContainer } from 'awilix';

export const TYPES = {
  Config: Symbol.for('Config'),
  ConfigProvider: Symbol.for('ConfigProvider'),
  Server: Symbol.for('Server'),
  Commands: Symbol.for('Commands'),
} as const;

export interface Context {
  server: any;
  config: any;
  logger: any;
  errorHandlerMiddleware: any;
}

export interface IPrismaConfig {
  env: string;
  logLevel: string;
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
}

/**
 * Structured logger contract — first argument may be either a plain message
 * string or an object of fields followed by an optional message.
 *
 * Examples:
 *   logger.info('user created');
 *   logger.info({ userId: '123' }, 'user created');
 *   logger.error({ err }, 'unexpected failure');
 */
export interface ILogger {
  info(message: string): void;
  info(fields: Record<string, unknown>, message?: string): void;
  error(message: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
  warn(message: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
  debug(message: string): void;
  debug(fields: Record<string, unknown>, message?: string): void;
  trace(message: string): void;
  trace(fields: Record<string, unknown>, message?: string): void;
  fatal(message: string): void;
  fatal(fields: Record<string, unknown>, message?: string): void;
  /** Create a derived logger with permanent context fields. */
  child(bindings: Record<string, unknown>): ILogger;
}

/**
 * Connector entry from `config.connectors.{name}`.
 * The shape varies per `type` — adapters validate their own subset.
 */
export type ConnectorConfig = { type: string } & Record<string, any>;

/**
 * Metadata a schema package exposes for tooling. Xenosis does not run
 * migrations itself — those stay owned by the schema package and its
 * underlying ORM CLI. This metadata simply records which ORM the
 * package wraps so consumers (or future tooling) can reason about it.
 */
export interface SchemaMeta {
  /** ORM family — informational, not used to dispatch migrate commands. */
  type: 'prisma' | 'drizzle' | 'knex' | 'mongo' | 'dynamo' | 'raw-sql';
  /** Absolute path to schema.prisma / drizzle config / migrations dir */
  schemaPath?: string;
  /** Where migration files live (if separate from schemaPath) */
  migrationsPath?: string;
}

/**
 * Contract every schema package must implement.
 * Schema packages are npm packages (typically workspace) that own a
 * database schema (Prisma/Drizzle/etc.) and are shared across services.
 */
export interface SchemaPackage<TClient = unknown> {
  /** Factory invoked by @xenosisorg/xenosis-core to build the runtime client. */
  createClient(connector: ConnectorConfig): TClient | Promise<TClient>;
  /** Optional teardown invoked on graceful shutdown. */
  disconnect?(client: TClient): Promise<void> | void;
  /** Static metadata used by tooling (ORM family, schema/migration paths). */
  schema: SchemaMeta;
}

/**
 * Schema binding in `config.schemas.{cradleKey}`.
 * Tells @xenosisorg/xenosis-core which package to load and which connector to pass it.
 */
export interface SchemaBinding {
  /** npm package name (must satisfy SchemaPackage). */
  package: string;
  /** Key in `config.connectors`. */
  connector: string;
}

/** Awilix lifetime — how often the container builds a fresh instance. */
export type AutoloadLifetime = 'singleton' | 'scoped' | 'transient';

/**
 * How autoload should register a file.
 * - 'class' → asClass(default export).<lifetime>() registered under the cradle key
 * - 'build' → container.build(default export) right after class entries; nothing
 *             is stored in the cradle. Used for function-style controllers.
 */
export type AutoloadStyle = 'class' | 'build';

/**
 * One entry in `xenosisBootstrap({ autoload })`. Key in the parent map is just a
 * label (e.g. 'repositories') — it does not affect runtime behaviour beyond
 * the special case where label === 'controllers' which defaults style to 'build'.
 */
export interface AutoloadEntry {
  pattern: string | string[];
  /** Default 'singleton'. Ignored when style is 'build'. */
  lifetime?: AutoloadLifetime;
  /** Default 'class' (or 'build' when the entry key is 'controllers'). */
  style?: AutoloadStyle;
}

export interface AutoloadOptions {
  [category: string]: AutoloadEntry;
}

/**
 * Optional named export from a file picked up by autoload.
 * Overrides whatever the pattern said for this specific file.
 *
 * Example:
 *   // CurrentUser.service.ts
 *   export default class CurrentUserService { ... }
 *   export const __xenosis: XenosisFileMeta = { lifetime: 'scoped' };
 */
export interface XenosisFileMeta {
  /** Override the pattern lifetime for this file only. */
  lifetime?: AutoloadLifetime;
  /** Override the cradle key derived from the filename. */
  name?: string;
  /** If true, autoload skips this file even though it matched the glob. */
  skip?: boolean;
}

/**
 * Shared modules — singletons that are loaded once at startup and exposed in
 * the cradle of EVERY service in the workspace. Think `config`, `redis`, but
 * for user-land things: whitelabel, feature flags, GeoIP DB, prefilled cache.
 *
 * Package layout:
 *   packages/shared-modules/<name>/
 *   ├── package.json
 *   └── src/
 *       ├── <Name>.ts        ← the class / factory (user-named)
 *       └── index.ts         ← default-exports the SharedModule object
 *
 * Each shared module package must default-export a `SharedModule`. The core
 * loader reads `xenosis.workspace.json` → `sharedModules: ['@org/whitelabel', …]`,
 * dynamically imports each one, calls `register(container)`, and (if present)
 * awaits `init(cradle)` before `commands.start()`.
 */
export interface SharedModule {
  /** Identifier — used in logs. Has no effect on cradle key (that's up to register). */
  name: string;
  /**
   * Synchronous: register awilix bindings. Typically:
   *   container.register({ whitelabel: asClass(WhitelabelService).singleton() });
   */
  register(container: AwilixContainer): void;
  /**
   * Optional: called once after every module has been registered and BEFORE
   * `commands.start()`. Use for async setup (DB query, remote fetch, file load).
   * Throwing here aborts the boot.
   */
  init?(cradle: any): Promise<void> | void;
  /**
   * Optional: called during graceful shutdown (V0.1). Mirror of init() for
   * teardown — close clients, flush buffers, stop timers.
   */
  disconnect?(cradle: any): Promise<void> | void;
}

export type { AwilixContainer };
