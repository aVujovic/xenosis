# Xenosis Documentation

> **Opinionated TypeScript microservice toolkit.** awilix DI without decorators, shared schema packages for databases, type-safe inter-service RPC from a JSON config — purpose-built for TypeScript microservice monorepos.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Quick Start](#2-quick-start)
3. [Core Concepts](#3-core-concepts)
4. [Configuration](#4-configuration)
5. [Service Structure](#5-service-structure)
6. [Connectors](#6-connectors)
7. [Schema Packages](#7-schema-packages)
8. [Autoload](#8-autoload)
9. [Shared Modules](#9-shared-modules)
10. [REST Layer](#10-rest-layer)
11. [OpenAPI & Swagger](#11-openapi--swagger)
12. [Authentication](#12-authentication)
13. [Peers — Internal RPC](#13-peers--internal-rpc)
14. [Peers — External APIs](#14-peers--external-apis)
15. [Reliability](#15-reliability)
16. [Tracing & Request Logging](#16-tracing--request-logging)
17. [Testing](#17-testing)
18. [MCP Server (AI tooling)](#18-mcp-server-ai-tooling)
19. [Dev Dashboard](#19-dev-dashboard)
20. [Examples](#20-examples)
21. [Roadmap](#21-roadmap)

---

## 1. Introduction

### What Xenosis is

Xenosis is a **TypeScript microservice toolkit** built for projects organised around independent services that talk to each other. It covers the layers every microservice ends up re-implementing — bootstrap, configuration, dependency injection, database orchestration, inter-service RPC, retry policies — so each new service starts on the same foundation.

It is **opinionated** about three things:

1. **Dependency injection** — `awilix` container, destructured constructor injection, no decorators.
2. **Multi-database orchestration** — schema packages own a Prisma/Drizzle/Mongo schema and are imported by multiple services.
3. **Peer communication** — `PeerApi<T>` contracts in shared npm packages, type-safe RPC client built from them.

Everything else is yours to choose: which ORM, which database mix, which deployment target, which observability stack.

### Where Xenosis shines

| Use case | What Xenosis gives you |
|---|---|
| Microservice monorepo, from 3 to 30+ services | Same conventions and scaffolding for every service |
| Multiple services on shared databases | One schema package, identical types across consumers |
| Internal RPC between services | `defineServiceApi` + `this.api.<name>.method(...)` — no codegen, routes kept in sync by `xenosis sync api` |
| Third-party API integrations (Stripe, Twilio, …) | `xenosis-custom/` with `errorMapper` and form encoding |
| Standard structure across a team | Autoload + naming convention enforced by the CLI |
| Rapid service creation | `xenosis create service/api/schema` from a single workspace config |

### What Xenosis is not

- Not an ORM. Xenosis orchestrates clients (Prisma, Drizzle, raw `pg.Pool`); you pick the ORM.
- Not a CMS or scaffold-everything framework — no CRUD generated from schema.
- Not an orchestrator. Service discovery, deploys, k8s manifests — your job.

---

## 2. Quick Start

Spin up a complete Xenosis monorepo in five minutes — bootstrap, scaffold a service, run it.

### Prerequisites

- Node.js ≥ 18 (for global `fetch` and `AbortController`)
- pnpm ≥ 9

### 1. Bootstrap a new monorepo

```bash
npx create-xenosis-app my-platform
```

You will be prompted for:

- **npm scope** for generated packages (e.g. `@myorg`)

When the prompt finishes you have a workspace skeleton with `xenosis.workspace.json`, `pnpm-workspace.yaml`, root `tsconfig.base.json`, and empty `packages/` + `services/` directories.

```bash
cd my-platform
pnpm install
```

### 2. Scaffold a service

```bash
xenosis create service users
```

A new service appears under `services/users-service/` with the canonical layout (autoload, healthcheck, sample CRUD). The CLI auto-assigns a port from the workspace config — the first service gets `4000`, the next `4001`, and so on.

### 3. Run it

```bash
pnpm --filter users-service dev
```

```bash
curl http://localhost:4000/healthcheck
# → "users-service is healthy!"

curl http://localhost:4000/api/v1/example
# → { "message": "Hello, world! — from users-service" }

curl -X POST http://localhost:4000/api/v1/example \
  -H 'content-type: application/json' \
  -d '{"name":"Alice"}'
# → { "message": "Hello, Alice! — from users-service" }
```

### 4. Add more services and APIs

```bash
# Shared schema package — multiple services can import it.
# Default is Prisma + Postgres; pass --orm and --db to change.
xenosis create schema psql-main
xenosis create schema mysql-billing --orm prisma  --db mysql
xenosis create schema cart          --orm drizzle
xenosis create schema reports       --orm knex
xenosis create schema events        --orm mongo
xenosis create schema audit         --orm dynamo

# Internal peer API — type-safe RPC between services
xenosis create api billing

# External API wrapper — Stripe, Twilio, etc. (lives under apis/xenosis-custom/)
xenosis create api stripe --external

# Another service — auto-assigned port 4001
xenosis create service billing
```

### 5. Run everything in parallel

```bash
xenosis dev
```

`xenosis dev` discovers every service in your workspace, runs them in parallel, and prefixes the logs with the service name (in different colors) so you can follow what is happening across the stack.

```text
→ Starting 2 services…
  • billing-service
  • users-service

[users-service]   🚀 Service is running on http://127.0.0.1:4000
[billing-service] 🚀 Service is running on http://127.0.0.1:4001
```

That is the whole loop. The rest of this document explains how the pieces fit.

#### Hot reload

Each service's `dev` script runs `tsx watch --include 'src/**/*' src/service.ts`. It watches the whole `src` tree and restarts the process on any change, using native OS filesystem events (fsevents on macOS, inotify on Linux) — fast, instant, and zero idle CPU. Graceful shutdown still runs between restarts: the previous process gets SIGTERM, drains peers/schemas, and releases its port before the new one boots.

If you run inside Docker, a VM, or a network/mounted filesystem where native events don't propagate, set the standard chokidar polling flag — `tsx watch` reads it natively, no config edits required:

```bash
CHOKIDAR_USEPOLLING=true pnpm dev
```

Leave it off everywhere else; polling burns CPU and adds latency.

### CLI cheat sheet

| Command | What it does |
|---|---|
| `npx create-xenosis-app <name>` | Bootstrap a new monorepo |
| `xenosis create service <name>` | Add a new service with autoload + healthcheck (`--lang ts\|js`) |
| `xenosis create api <name>` | Add an internal peer API package |
| `xenosis create api <name> --external` | Add an external API wrapper under `xenosis-custom/` |
| `xenosis create schema <name>` | Add a schema package — `--orm prisma\|drizzle\|knex\|mongo\|dynamo`, `--db postgres\|mysql` |
| `xenosis create shared-module <name>` | Add a workspace-wide cradle singleton (`--lang ts\|js`, `--style class\|function`) |
| `xenosis sync api <service>` | Regenerate `apis/<service>-api/src/index.ts` from `/** @peer */` directives on the service's controllers |
| `xenosis create test <service>` | Add the `__tests__` scaffold (setup + supertest) to an existing service |
| `xenosis graph` | Print the peer dependency graph + lint `boundaries.allowedCallers` (`--json`) |
| `xenosis generate manifest` | Emit `src/.xenosis-manifest.ts` so autoload survives a production bundle |
| `xenosis dev` | Run every service in parallel with prefixed logs |
| `xenosis init mcp` | Write `.mcp.json` so Claude / Cursor / Claude Desktop get workspace-aware tools — see [§ 18](#18-mcp-server-ai-tooling) |

---

## 3. Core Concepts

### The container

Every Xenosis service has a single awilix container (`src/container.ts`). The container holds:

- **Core entries** registered by `xenosisBootstrap`: `logger`, `config`, `server`, `commands`, fallback connector providers (`prisma`, `redis`, `mysql`, `mongo`, `dynamo`), `errorHandlerMiddleware`.
- **Schema entries** registered by the schema loader from `config.schemas`: one cradle key per binding (e.g. `mainDb`, `analyticsDb`).
- **Peer entries** registered by the peer loader from `config.peers`: one type-safe RPC client per peer (e.g. `billing`, `stripe`).
- **User entries** registered by autoload (or manually): repositories, services, controllers.

### The cradle

The container's `cradle` is the destructured surface. Any class can ask for any registered entry by name:

```ts
class UserService {
  constructor({ logger, userRepository, mainDb, api }: {
    logger: ILogger;
    userRepository: UserRepository;
    mainDb: PrismaClient;
    api: { billing: BillingServiceApi };
  }) { /* ... */ }
}
```

awilix resolves the dependencies at instantiation. There is no `@Inject(TYPES.X)` boilerplate.

### Lifecycle

1. `xenosisBootstrap({ container, autoload? })` is called.
2. Core providers are registered (lazy — instantiated on first cradle access).
3. Schema packages are dynamically imported; their `createClient(connector)` is called and the result is registered in the cradle.
4. Peer bindings are processed; `cradle.api.<name>` is built for each `config.peers.<name>`.
5. Shared modules are registered (workspace-wide singletons).
6. Autoload globs the user-land directories and registers matched classes / mounts matched controllers.
7. `commands.start()` mounts the error handler middleware and calls `server.listen(config.port, ...)`.

### Glossary

| Term | Meaning |
|---|---|
| **Cradle key** | The name a registered entry has in the awilix container. Used in destructured constructor params. |
| **Schema package** | An npm package that owns a database schema (Prisma/Drizzle/…) and exports a `SchemaPackage<TClient>`. |
| **Peer** | Another Xenosis service in the workspace, reached via `this.api.<name>.method(...)`. |
| **Service API package** | A small package per service (e.g. `apis/billing-api`) exporting types and a `defineServiceApi(...)` routes table. The contract source of truth. |
| **`@peer` directive** | A JSDoc tag above a controller route. `xenosis sync api <service>` reads it to regenerate the API package's routes block. |
| **Connector** | A raw client (Postgres, Redis, Mongo, …) for the single-schema fallback case. |
| **Autoload** | Glob-driven discovery of user-land classes and controllers. |

---

## 4. Configuration

Every service is started with `--config <path>`. The config is a JSON object the service receives in cradle as `config`.

### Full example

```jsonc
{
  "name": "users-service",
  "peerName": "users",
  "env": "development",
  "logLevel": "info",
  "port": 4001,

  "allowedOrigins": ["http://localhost:3000"],

  "serverOptions": {
    "bodySizeLimit": "50mb"
  },

  // Inbound access control — only these services may call this one.
  // Omit to stay open to all. See §13.
  "boundaries": {
    "allowedCallers": ["billing", "orders"]
  },

  // Shared-token gate for every inbound request. See §12.
  "authentication": {
    "enabled": false,
    "token": "",
    "exempt": ["/openapi.json", "/docs"]
  },

  "connectors": {
    "psqlMain": {
      "type": "postgres",
      "url": "postgresql://xenosis:xenosis_dev@localhost:5432/xenosis_main"
    },
    "redis": {
      "type": "redis",
      "host": "localhost",
      "port": 6379
    }
  },

  "schemas": {
    "mainDb": {
      "package": "@example/psql-main",
      "connector": "psqlMain"
    }
  },

  "peers": {
    "billing": {
      "package": "@example/billing-api",
      "transport": "http",
      "baseUrl": "http://localhost:4002",
      "timeoutMs": 5000,
      "retry": { "attempts": 2, "backoffMs": 200 }
    },
    "stripe": {
      "package": "@example/xenosis-custom-stripe-api",
      "transport": "http",
      "baseUrl": "https://api.stripe.com",
      "bodyEncoding": "form-urlencoded",
      "headers": { "Authorization": "Bearer sk_test_..." }
    }
  }
}
```

### Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | recommended | Used in logs and tracing. |
| `peerName` | `string` | optional | Short identity used as the peer cradle key, in other services' `boundaries.allowedCallers`, and sent as `x-xenosis-caller` on outbound peer calls. Falls back to `name`. See [Peers — Internal](#13-peers--internal-rpc). |
| `env` | `'development' \| 'staging' \| 'production'` | optional | |
| `logLevel` | `'error' \| 'warn' \| 'info' \| 'debug' \| 'trace' \| 'fatal'` | optional | Default `'info'`. |
| `port` | `number` | required | HTTP listen port. |
| `allowedOrigins` | `string[]` | optional | CORS allowlist. Patterns enclosed in `/^...$/` are matched as regex. |
| `serverOptions.bodySizeLimit` | `string \| number` | optional | Default `'50mb'`. |
| `requestLog` | `'start' \| 'end' \| 'both' \| 'off'` | optional | Per-request logging mode. Default `'end'`. See [Tracing & Request Logging](#16-tracing--request-logging). |
| `connectors` | `Record<string, ConnectorConfig>` | optional | See [Connectors](#6-connectors). |
| `schemas` | `Record<string, SchemaBinding>` | optional | See [Schema Packages](#7-schema-packages). |
| `peers` | `Record<string, PeerBinding>` | optional | See [Peers — Internal](#13-peers--internal-rpc). Each binding: `package`, `transport: 'http'`, `baseUrl`, optional `apiKey`, `headers`, `bodyEncoding: 'json' \| 'form-urlencoded'`, and reliability knobs (`timeoutMs`, `retry`, `circuitBreaker`). |
| `boundaries.allowedCallers` | `string[]` | optional | Inbound peer allowlist. Calls carrying an `x-xenosis-caller` not in the list get 403. Omit to stay open. See [Peers — Internal](#13-peers--internal-rpc). |
| `authentication` | `{ enabled, token, exempt? }` | optional | Built-in shared-token gate for all inbound requests. See [Authentication](#12-authentication). |
| `openapi` | `{ enabled?, path?, jsonPath?, title?, version? }` | optional | OpenAPI 3.1 spec + Swagger UI. On by default; set `enabled: false` to opt out. See [OpenAPI & Swagger](#11-openapi--swagger). |

### Loading sources

Xenosis looks for the config in the following order:

1. `--config <path>` CLI flag
2. `CONFIG_PATH` environment variable
3. `workerData.config` (when running in a worker thread)

`--common-config <path>` can be used to layer a base config under the service-specific one. Service config overrides common values.

### Validation & typed config

The config is validated against a **zod schema at boot** — the same tool Xenosis uses for peer schemas. A malformed config aborts startup with a precise error (which key, what was expected) instead of surfacing as `undefined` deep inside a loader:

```
[xenosis] Invalid xenosis.config.json:
  • port: Expected number, received string
Fix the config (or your src/config.schema.ts) and restart.
```

The base schema (`xenosisConfigSchema`) is `.passthrough()` — known keys are validated, unknown keys are kept (forward-compatible). `XenosisConfig` is the inferred type, threaded through the loaders/providers so config access is typed, not `any`.

**Your own typed config keys.** Add `src/config.schema.ts` to your service, default-exporting an extended schema via `defineConfigSchema`. Xenosis auto-loads it at boot and validates the merged shape:

```ts
// src/config.schema.ts
import { defineConfigSchema, z } from '@xenosisorg/xenosis-core';

export default defineConfigSchema({
  stripe: z.object({
    secretKey: z.string(),
    webhookSecret: z.string(),
  }),
});
```

Now `config.stripe.secretKey` is typed everywhere (cradle, services), and a missing or wrong `stripe` block aborts startup — the same guarantee Xenosis gives its own keys, for yours. `xenosis create service` scaffolds this file (empty) so the convention is discoverable.

---

## 5. Service Structure

Xenosis services follow a canonical directory layout. The convention is enforced softly by autoload naming rules and (eventually) by `xenosis create service`.

```
my-service/
├── xenosis.config.json
├── config.example.json
├── package.json
├── tsconfig.json
└── src/
    ├── service.ts                ← bootstrap (5–10 lines)
    ├── container.ts              ← createContainer() + Context typedef
    ├── config.schema.ts          ← zod schema for xenosis.config.json
    ├── types.ts                  ← Express.Request augmentation, custom types
    ├── api/
    │   ├── healthcheck/
    │   │   └── healthcheck.controller.ts
    │   └── <feature>/
    │       ├── <feature>.controller.ts
    │       └── <feature>.schema.ts
    ├── services/
    │   └── <Pascal>.service.ts
    ├── repository/
    │   └── <Pascal>.repository.ts
    ├── middlewares/              ← optional
    │   └── <name>.middleware.ts
    └── jobs/                     ← optional
        └── <Pascal>.job.ts
```

### Bootstrap

```ts
// src/service.ts
import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';

await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.ts', lifetime: 'singleton' },
    services:     { pattern: 'src/services/*.service.ts',      lifetime: 'singleton' },
    controllers:  { pattern: 'src/api/**/*.controller.ts',     style: 'build' },
  },
});

await container.cradle.commands.start();
```

### Container

```ts
// src/container.ts
import { createContainer } from 'awilix';

/**
 * @typedef {Object} ServiceContext
 * @property {import('./services/User.service').default} userService
 * @property {import('./repository/User.repository').default} userRepository
 */

/**
 * @typedef {import('@xenosisorg/xenosis-core').Context & ServiceContext} Context
 */

const container = createContainer();
export default container;
```

---

## 6. Connectors

A **connector** is a raw database client. Five drivers ship with `@xenosisorg/xenosis-core` as single-schema fallback providers:

- `postgres` (via Prisma)
- `mysql` (via `mysql2`)
- `mongo` (via `mongodb`)
- `dynamo` (via `@aws-sdk/client-dynamodb`)
- `redis` (via `ioredis`)

### Single-schema fallback usage

If your service uses one database only and you do not need the schema-package abstraction, declare it under `connectors` and inject the provider directly:

```jsonc
{
  "connectors": {
    "psql": {
      "type": "postgres",
      "host": "localhost",
      "port": 5432,
      "username": "postgres",
      "password": "postgres",
      "database": "my_service"
    }
  }
}
```

```ts
class MyService {
  constructor(private deps: { prisma: PrismaClient }) {}
  //                          ^^^^^^ cradle key from fallback provider
}
```

### Connector reference

| Connector | Required fields | Cradle key (fallback) |
|---|---|---|
| `postgres` | `host`, `port`, `username`, `password`, `database` *(or `url`)* | `prisma` |
| `mysql` | `host`, `port`, `username`, `password`, `database` | `mysql` |
| `mongo` | `url`, `database` | `mongo` |
| `dynamo` | `region` *(+ optional `endpoint`, `accessKeyId`, `secretAccessKey`)* | `dynamo` |
| `redis` | `host`, `port` | `redis` |

### When to prefer schema packages instead

Use a schema package (next section) when **multiple services share the same database and need the same types**. The fallback is for single-service apps and one-off scripts.

---

## 7. Schema Packages

A schema package is an npm package (typically a workspace package) that owns one database schema and exports a `SchemaPackage<TClient>`. Multiple services import the same package and share types and tables.

### The contract

```ts
// packages/db-schemas/psql-main/src/index.ts
import { PrismaClient } from '@prisma/client';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';

const pkg: SchemaPackage<PrismaClient> = {
  createClient(connector) {
    return new PrismaClient({
      datasources: { db: { url: connector.url } },
    });
  },
  async disconnect(client) {
    await client.$disconnect();
  },
  schema: {
    type: 'prisma',
    schemaPath: new URL('../prisma/schema.prisma', import.meta.url).pathname,
    migrationsPath: new URL('../prisma/migrations', import.meta.url).pathname,
  },
};

export default pkg;
export { PrismaClient };
```

### Binding a schema package to a service

```jsonc
{
  "connectors": {
    "psqlMain": { "type": "postgres", "url": "postgresql://..." }
  },
  "schemas": {
    "mainDb": {
      "package": "@example/psql-main",
      "connector": "psqlMain"
    }
  }
}
```

At boot, Xenosis dynamically imports `@example/psql-main`, calls `pkg.createClient(connectorsConfig.psqlMain)`, and registers the result under `cradle.mainDb`.

### Sharing across services

If two services both import `@example/psql-main` and pass the same connector URL, they each get their own PrismaClient instance pointing at the same database, both with **identical types** (same generated client).

### Migrations

Schema packages own their migrations. Run them with the underlying ORM CLI:

```bash
DATABASE_URL='postgresql://...' pnpm --filter @example/psql-main exec prisma migrate deploy
```

Auto-migration on service boot is not enabled — it is a footgun in multi-service setups (race conditions on parallel deploys). Migrations belong in a dedicated CI job.

### Non-Prisma examples

Drizzle, Mongo, Dynamo all fit the same shape. See [SCHEMAS.md](./SCHEMAS.md) for the full convention and additional examples.

---

## 8. Autoload

Autoload is opt-in glob-based discovery that eliminates manual `container.register({...})` boilerplate for repositories, services, and controllers.

### Default usage

```ts
await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.ts', lifetime: 'singleton' },
    services:     { pattern: 'src/services/*.service.ts',      lifetime: 'singleton' },
    controllers:  { pattern: 'src/api/**/*.controller.ts',     style: 'build' },
  },
});
```

### Naming convention (strict)

Files must end with `.<suffix>.ts` (or `.js`). The suffix is derived from the category key by stripping the trailing plural:

- `repositories` → `.repository.ts`
- `services` → `.service.ts`
- `controllers` → `.controller.ts`
- `middlewares` → `.middleware.ts`
- `jobs` → `.job.ts`

The cradle key is derived from the filename:

| Filename | Cradle key |
|---|---|
| `User.repository.ts` | `userRepository` |
| `UserAccount.repository.ts` | `userAccountRepository` |
| `Stripe.service.ts` | `stripeService` |
| `user.controller.ts` | *(no cradle key — controllers use style `'build'`)* |

Files that don't match the suffix throw at boot with a clear error.

### Style: `'class'` vs `'build'`

| Style | What happens | Use case |
|---|---|---|
| `'class'` | `asClass(default).<lifetime>()` registered under the derived cradle key | repositories, services, middlewares, jobs |
| `'build'` | `container.build(default)` called once, no cradle entry | controllers (function-style factories) |

Default style is `'class'`. Exception: when the category key is literally `controllers`, default flips to `'build'`.

### Per-file override

When one file in a folder needs different semantics, add a `__xenosis` named export:

```ts
// CurrentUser.service.ts
import type { XenosisFileMeta } from '@xenosisorg/xenosis-core';

export default class CurrentUserService { /* ... */ }

export const __xenosis: XenosisFileMeta = {
  lifetime: 'scoped',       // override pattern lifetime
  // name: 'currentUser',   // override derived cradle key
  // skip: true,            // exclude from autoload
};
```

### Custom categories (jobs, workers, gateways, …)

The three categories shown above (`repositories`, `services`, `controllers`) are not hard-coded — **any key works**. Autoload singularizes the category name and looks for files with the matching suffix.

```ts
await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.ts' },
    services:     { pattern: 'src/services/*.service.ts' },
    controllers:  { pattern: 'src/api/**/*.controller.ts', style: 'build' },

    // Add anything else you need:
    jobs:     { pattern: 'src/jobs/*.job.ts' },           // → cradle.*Job
    workers:  { pattern: 'src/workers/*.worker.ts' },     // → cradle.*Worker
    gateways: { pattern: 'src/gateways/*.gateway.ts' },   // → cradle.*Gateway
    consumers:{ pattern: 'src/consumers/*.consumer.ts' }, // → cradle.*Consumer
  },
});
```

Autoload **only registers** these classes in the cradle — it does not call any lifecycle method on them. You decide when and how to start them in `service.ts`:

```ts
// src/jobs/Heartbeat.job.ts
export default class HeartbeatJob {
  constructor({ logger }: { logger: ILogger }) {}
  start(intervalMs = 60_000) { /* setInterval, cron.schedule, queue.consume … */ }
  stop() { /* cleanup */ }
}
```

```ts
// src/service.ts
await xenosisBootstrap({ container, autoload: { /* … jobs entry … */ } });
await container.cradle.commands.start();

// Explicit: kick off background work after the server is listening.
container.cradle.heartbeatJob.start();
```

This keeps autoload predictable — registration is implicit, side effects are explicit.

### Manual registration coexists

Anything autoload does not cover can be registered manually after `xenosisBootstrap`:

```ts
await xenosisBootstrap({ container, autoload: { /* ... */ } });

container.register({
  authMiddleware: asFunction(buildAuthMiddleware).singleton(),
  stripe:         asValue(new Stripe(process.env.STRIPE_KEY!)),
});

await container.cradle.commands.start();
```

Manual `register` overrides autoload registrations of the same name.

See [AUTOLOAD.md](./AUTOLOAD.md) for the full reference.

---

## 9. Shared Modules

Shared modules are workspace-wide singletons exposed in the **cradle of every service** — just like `config`, `logger`, or `redis`, but defined in user-land. Typical use cases: whitelabel config loaded once from the DB, feature flags fetched from a remote, GeoIP database held in memory, currency/locale resolver shared across services.

### How they're discovered

Shared modules are listed in `xenosis.workspace.json` at the monorepo root:

```jsonc
{
  "scope": "@myorg",
  "structure": {
    "apis": "packages/apis",
    "schemas": "packages/db-schemas",
    "services": "services",
    "sharedModules": "packages/shared-modules"
  },
  "sharedModules": [
    "@myorg/whitelabel",
    "@myorg/feature-flags"
  ]
}
```

At boot, `@xenosisorg/xenosis-core` reads the `sharedModules` list, dynamically imports each package, calls its `register(container)` hook to install awilix bindings, then awaits the optional `init(cradle)` hook before `commands.start()`. The user's `service.ts` does not change — modules just **appear** in the cradle.

### The package contract

```ts
// packages/shared-modules/whitelabel/src/index.ts
import { asClass } from 'awilix';
import type { SharedModule } from '@xenosisorg/xenosis-core';
import { Whitelabel } from './Whitelabel';

export { Whitelabel };

const module: SharedModule = {
  name: 'whitelabel',
  register(container) {
    container.register({
      whitelabel: asClass(Whitelabel).singleton(),
    });
  },
  async init(cradle) {
    await cradle.whitelabel.load();   // optional async setup
  },
};

export default module;
```

```ts
// packages/shared-modules/whitelabel/src/Whitelabel.ts
import type { ILogger } from '@xenosisorg/xenosis-core';

export class Whitelabel {
  private cache?: BrandConfig;
  constructor(private deps: { logger: ILogger; mainDb: PrismaClient }) {}

  async load() {
    this.cache = await this.deps.mainDb.brand.findFirst();
  }

  get(): BrandConfig {
    if (!this.cache) throw new Error('Whitelabel not loaded');
    return this.cache;
  }
}
```

### How services consume it

Zero ceremony — just declare the cradle key in your constructor:

```ts
import type { Whitelabel } from '@myorg/whitelabel';

export default class UserService {
  constructor(private deps: { whitelabel: Whitelabel }) {}

  async create(input: CreateUserInput) {
    const brand = this.deps.whitelabel.get();
    // …
  }
}
```

No `import` in `service.ts`. No `container.register({ whitelabel: ... })`. The module is already there because the workspace says so.

### Scaffolding via the CLI

```bash
# Class style (default) — bound with asClass(...).singleton()
xenosis create shared-module whitelabel

# Function style — bound with asFunction(...)
xenosis create shared-module currency --style function

# Different lifetime
xenosis create shared-module currentUser --lifetime scoped
```

The CLI generates the package under `packages/shared-modules/<name>/`, adds the package name to `xenosis.workspace.json` → `sharedModules`, and runs `pnpm install`.

### Lifecycle hooks

| Hook | When | Async? |
|---|---|---|
| `register(container)` | At boot, before any other module's `init()` | sync |
| `init(cradle)` *(optional)* | After every module is registered, before `commands.start()` | async |
| `disconnect(cradle)` *(optional, V0.1)* | On SIGTERM, before exit | async |

`register()` runs in the order modules appear in the `sharedModules` array. `init()` also runs in that order — so a module's init can resolve another module's cradle entry, as long as the dependency is listed first.

### When to use shared modules vs. peers

| If you want… | Use |
|---|---|
| Local singleton instance running in every service (whitelabel, feature flags, in-memory cache) | **Shared module** |
| Network call to fetch fresh data from another service's database | **Peer** (`@myorg/users-api`) |
| Pure utility classes / formatters / validators | **Shared module** (or plain npm import — no DI needed) |

---

## 10. REST Layer

Xenosis ships a small REST layer on top of Express: `Handler`, `Response`, `Exception`, `Request`.

### Controller pattern

Function-style, picked up by autoload:

```ts
import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import type { IServer } from '@xenosisorg/xenosis-core';
import type UserService from '../../services/User.service';
import { createUserSchema, idParamSchema } from './user.schema';

export default function UserController({
  server, userService,
}: { server: IServer; userService: UserService }) {
  const router = Router();

  router.route('/').post(
    Handler(Request.Body(createUserSchema), async (body) => {
      const user = await userService.create(body);
      return Response.Created(user);
    }),
  );

  router.route('/:id').get(
    Handler(Request.Params(idParamSchema), async ({ id }) => {
      const user = await userService.findById(id);
      return user ? Response.OK(user) : Response.NotFound({ id });
    }),
  );

  server.use('/api/v1/users', router);
}
```

### Handler composition

`Handler(...selectors, handler)` lets you compose request-level extractors before the handler:

```ts
Handler(
  Request.Params(idParamSchema),
  Request.Body(updateBodySchema),
  Request.Headers(authHeadersSchema),
  async (params, body, headers) => {
    // params, body, headers are typed from their zod schemas
    return Response.OK(await service.update(params.id, body, headers));
  },
);
```

### Responses

Static factories return a `Response` instance — call `.apply(res)` happens inside `Handler`:

```ts
Response.OK(payload)
Response.Created(payload)
Response.NoContent()
Response.Accepted(payload)
Response.NotFound({ id })
Response.BadRequest({ reason })
```

You can also `new Response(status, body, headers)` for custom statuses. The `StatusCode` map is exported for readable literals (`StatusCode.OK === 200`, `StatusCode.CREATED === 201`, …):

```ts
import { Response, StatusCode } from '@xenosisorg/xenosis-core';

return new Response(StatusCode.ACCEPTED, payload);
```

### Exceptions

Throw vendor-correct status from anywhere in the request stack:

```ts
import { Exception } from '@xenosisorg/xenosis-core';

if (!user) throw Exception.NotFound({ userId: id });
if (user.blocked) throw Exception.Forbidden({ reason: 'blocked' });
throw Exception.InternalServerError({ trace: '...' });
```

`errorHandlerMiddleware` (registered by `commands.start()` after all routes) catches `Exception` instances and emits JSON `{ name, message, body, status }`.

### Request validation

Three helpers built on zod:

| Helper | Validates | Returns |
|---|---|---|
| `Request.Body(zodSchema)` | request body | parsed body |
| `Request.Params(zodSchema)` | path params | parsed params |
| `Request.Query(zodSchema)` | query string | parsed query |
| `Request.Headers(zodSchema)` | headers | parsed headers |

Validation failures throw `Exception.BadRequest` with the zod issues attached.

These same selectors — plus an optional `.returns(schema)` on a `Handler` — feed the auto-generated OpenAPI 3.1 spec and Swagger UI. See [OpenAPI & Swagger](#11-openapi--swagger).

---

## 11. OpenAPI & Swagger

Every Xenosis service exposes a machine-readable **OpenAPI 3.1** document and a **Swagger UI** explorer — generated automatically from the controllers and zod schemas you already write. No annotations, no separate spec file, no codegen step.

- `GET /openapi.json` — the OpenAPI 3.1 document
- `GET /docs` — Swagger UI, pointed at the spec

Both are mounted at boot, **after** every controller has registered its routes (so the spec always matches what the service actually serves) and **before** `commands.start()` appends the error handler.

### How it works

Routes are captured as they mount via the recording `Router`. Request schemas are recovered from the `Request.Body` / `Request.Query` / `Request.Params` selectors you already pass to `Handler`. Path params (`:id`) become OpenAPI `{id}` parameters. zod schemas are converted to JSON Schema (via `zod-to-json-schema`) for the document.

This is fully **additive** — existing controllers are documented as-is, with no code changes.

### Documenting responses with `.returns()`

A route's request shape is known from its selectors, but the response shape is not. Declare it with the optional, chainable `.returns(schema)` on a `Handler`:

```ts
import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import {
  listUsersQuerySchema, userListSchema, userSchema, idParamSchema,
} from './user.schema';

const router = Router();

// Response documented as an array of users.
router.route('/').get(
  Handler(Request.Query(listUsersQuerySchema), async (query) => {
    return Response.OK(await userService.list(query));
  }).returns(userListSchema),
);

// Path param + documented single-user response.
router.route('/:id').get(
  Handler(Request.Params(idParamSchema), async ({ id }) => {
    const user = await userService.findById(id);
    return user ? Response.OK(user) : Response.NotFound({ id });
  }).returns(userSchema),
);
```

Routes without `.returns()` still appear with a generic `200` — add it where a documented response payload matters.

### What ends up in the spec

| Source in your code | OpenAPI output |
|---|---|
| `router.route('/x').post(...)` | path `/x`, method `post` |
| `:id` in the path | `{id}` path parameter (string) |
| `Request.Body(schema)` | `requestBody` (JSON, required) |
| `Request.Query(schema)` | query `parameters` with constraints |
| `Request.Params(schema)` | path `parameters` |
| `.returns(schema)` | `responses.200` JSON schema |

### Configuration

OpenAPI is on by default. Control it from `xenosis.config.json`:

```jsonc
{
  "name": "users-service",
  "port": 4001,
  "openapi": {
    "enabled": true,
    "path": "/docs",
    "jsonPath": "/openapi.json",
    "title": "Users Service API",
    "version": "1.0.0",
    "description": "User accounts and profiles."
  }
}
```

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Set `false` to disable both routes (they 404). |
| `path` | `/docs` | Swagger UI page. |
| `jsonPath` | `/openapi.json` | Spec document. |
| `title` | `config.name` | Spec `info.title`. |
| `version` | `1.0.0` | Spec `info.version`. |
| `description` | — | Optional spec description. |

### Try it

```bash
curl http://localhost:4001/openapi.json | jq .paths   # the spec
open http://localhost:4001/docs                        # Swagger UI
```

For production, disable it on public-facing services and keep it behind your internal network or for staging.

---

## 12. Authentication

Xenosis does not ship an opinionated auth layer — auth is an application decision (JWT vs session vs API key, role model, multi-tenant flow, etc.). What Xenosis **does** give you is the wiring to plug standard Express middleware into the request scope so authenticated users flow through DI like any other cradle key.

The canonical pattern uses three building blocks already in `@xenosisorg/xenosis-core`:

- `Exception.Unauthorized(...)` — standard 401 response when auth fails
- `req.scope.register({ currentUser: asValue(user) })` — attach the authenticated user to the per-request awilix scope
- `getRequestContext()` — read the scope from anywhere the cradle isn't injected

### Anatomy of an auth middleware

```ts
// src/middlewares/Auth.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { Exception } from '@xenosisorg/xenosis-core';
import { asValue } from 'awilix';
import jwt from 'jsonwebtoken';

export function buildAuthMiddleware(opts: { jwtSecret: string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return next(Exception.Unauthorized({ reason: 'missing token' }));
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, opts.jwtSecret) as jwt.JwtPayload;
    } catch (err) {
      return next(Exception.Unauthorized({
        reason: err instanceof Error ? err.message : 'invalid token',
      }));
    }

    // Register the user on the per-request scope so anyone downstream can
    // inject `currentUser` from the cradle.
    req.scope?.register({
      currentUser: asValue({
        id: String(payload.sub),
        email: payload.email,
        name: payload.name,
      }),
    });

    next();
  };
}
```

### Wiring it into the container

Register the middleware factory once during bootstrap so awilix resolves it lazily from `config`:

```ts
// src/service.ts
import { asFunction } from 'awilix';
import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';
import { buildAuthMiddleware } from './middlewares/Auth.middleware';

container.register({
  authMiddleware: asFunction(({ config }: { config: any }) =>
    buildAuthMiddleware({ jwtSecret: config.auth.jwtSecret }),
  ).singleton(),
});

await xenosisBootstrap({ container, autoload: { /* … */ } });
await container.cradle.commands.start();
```

### Public vs protected routes

Apply `authMiddleware` per route — explicit, Express-idiomatic, IDE-searchable:

```ts
// src/api/user/user.controller.ts
import type { RequestHandler } from 'express';

export default function UserController({
  server,
  userService,
  authMiddleware,
}: {
  server: IServer;
  userService: UserService;
  authMiddleware: RequestHandler;
}) {
  const router = Router();

  // Public — anyone can list / sign up
  router.route('/').get(Handler(...));
  router.route('/').post(Handler(...));

  // Protected — auth runs before Handler. 401 if it throws.
  router.route('/:id').get(authMiddleware, Handler(...));
  router.route('/:id/upgrade').post(authMiddleware, Handler(...));

  server.use('/api/v1/users', router);
}
```

Want a whole sub-router protected? Mount the middleware at the prefix:

```ts
const admin = Router();
admin.use(authMiddleware);
admin.get('/cohorts', cohortsHandler);
admin.post('/feature-flags', flagsHandler);
server.use('/api/v1/admin', admin);
```

### Reading the current user

Three ways, pick by use case:

**1. Per-request scoped service** *(cleanest, but new pattern)*

Mark the service `scoped` in autoload. Awilix instantiates it once per request, so the cradle lookup gives the request's `currentUser`:

```ts
// autoload entry
services: {
  pattern: 'src/services/*.service.ts',
  lifetime: 'scoped',
}

// Profile.service.ts
class ProfileService {
  constructor(private deps: { currentUser: CurrentUser }) {}
  me() { return this.deps.currentUser; }
}
```

**2. Cradle access in a controller**

The controller already has access to `req.scope`. Pull `currentUser` ad-hoc:

```ts
router.route('/me').get(
  authMiddleware,
  Handler(async (req: Request) => {
    const user = req.scope?.cradle.currentUser as CurrentUser;
    return Response.OK(user);
  }),
);
```

**3. `getRequestContext()` from a singleton service**

When the consuming service is `singleton` (the default) the constructor can't take a per-request key — use the helper:

```ts
import { getRequestContext } from '@xenosisorg/xenosis-core';

class UserService {
  async upgrade(input) {
    const ctx = getRequestContext();
    const currentUser = ctx?.scope.cradle.currentUser as CurrentUser | undefined;

    if (currentUser && currentUser.id !== input.userId) {
      throw new Error('Cannot upgrade another user');
    }
    // …
  }
}
```

### Issuing tokens

The login endpoint is a normal public route. The example service ships an `Auth.service.ts` that signs a JWT:

```ts
// src/services/Auth.service.ts
import jwt from 'jsonwebtoken';

export default class AuthService {
  constructor(private deps: {
    userRepository: UserRepository;
    config: { auth: { jwtSecret: string; jwtExpiresIn?: string } };
  }) {}

  async loginByEmail(email: string) {
    const user = await this.deps.userRepository.findByEmail(email);
    if (!user) throw new Error('not found');

    const token = jwt.sign(
      { email: user.email, name: user.name },
      this.deps.config.auth.jwtSecret,
      { subject: user.id, expiresIn: this.deps.config.auth.jwtExpiresIn ?? '1h' },
    );
    return { token, user };
  }
}
```

```ts
// src/api/auth/auth.controller.ts
router.route('/login').post(
  Handler(Request.Body(loginBodySchema), async (body) => {
    const result = await authService.loginByEmail(body.email);
    return Response.OK(result);
  }),
);

server.use('/api/v1/auth', router);   // PUBLIC — no authMiddleware
```

### Where this stops being a demo

The pattern above is what every Xenosis app uses. To make it production-grade, add:

- **Password hashing**: argon2 or bcrypt for the user record, verify in `loginByEmail`.
- **Short-lived access tokens + refresh tokens**: rotate access JWT every 15 min; refresh tokens persisted with revocation table.
- **Token blacklist**: Redis set keyed on `jti` claim for logout / forced revocation.
- **Rate limiting**: in front of `/auth/login` to slow credential stuffing.
- **mTLS or signed gateway**: for inter-service auth — see v0.2 roadmap (`@xenosisorg/peers-auth`).

None of these change the **Xenosis wiring** — they go inside `Auth.service.ts` and `Auth.middleware.ts` in your app.

### Built-in shared-token gate

For internal services, a private dashboard, or any surface that just needs a single shared secret in front of it, Xenosis ships a config-only gate — no middleware to write. Enable it under `authentication`:

```jsonc
"authentication": {
  "enabled": true,
  "token": "s3cr3t",
  // /healthcheck is ALWAYS exempt; add more bypass prefixes here.
  "exempt": ["/openapi.json", "/docs"]
}
```

When `enabled`, every inbound request must present the token via any of:

- `Authorization: Bearer <token>`
- `x-auth-token: <token>`
- `?authToken=<token>` query param

A missing or wrong token returns **401** `{ "error": "Unauthorized" }`. `/healthcheck` (and sub-paths) is always exempt so liveness probes work without a token; add the OpenAPI paths to `exempt` if you want the spec/UI reachable.

```bash
curl localhost:4001/api/v1/users                       # → 401
curl -H "Authorization: Bearer s3cr3t" localhost:4001/api/v1/users   # → 200
curl "localhost:4001/api/v1/users?authToken=s3cr3t"    # → 200
curl localhost:4001/healthcheck                        # → 200 (exempt)
```

This gate is a coarse, all-or-nothing shared secret — it runs as the first middleware, before any route. It does **not** replace the per-route JWT pattern above (different concern: user identity vs. a service-wide door). The two can coexist: the gate fronts the whole service, JWT identifies the user on protected routes. New services scaffold with this block present but `enabled: false`.

---

## 13. Peers — Internal RPC

Every Xenosis service has a public REST surface (its controllers). Sibling services in the same workspace can call those same routes through a typed proxy: `this.api.<name>.method(...)`. The public route and the peer surface are the same thing.

The contract lives in a small API package per service (e.g. `apis/billing-api`). It exports:

- A TypeScript type describing every callable method, its input, and its return value.
- A `defineServiceApi` default export that maps method names to HTTP routes.

### The API package

```ts
// apis/billing-api/src/index.ts
import { defineServiceApi } from '@xenosisorg/xenosis-core';

export interface ChargeRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
}

export type BillingServiceApi = {
  createCharge(input: {
    userId: string;
    amount: number;
    currency: string;
  }): Promise<{ id: string; status: 'completed' }>;

  refund(input: { chargeId: string; reason?: string }): Promise<void>;
  getCharge(params: { id: string }): Promise<ChargeRecord>;
};

// Routes block is regenerated by `xenosis sync api billing` from the
// @peer JSDoc directives on the controllers below.
export default defineServiceApi<BillingServiceApi>({
  name: 'billing',
  routes: {
    createCharge: { method: 'POST', path: '/api/v1/charges' },
    refund:       { method: 'POST', path: '/api/v1/charges/refund' },
    getCharge:    { method: 'GET',  path: '/api/v1/charges/:id' },
  },
});
```

### Provider side — tag controllers with `@peer`

```ts
// billing-service/src/api/charge/charge.controller.ts
import { Handler, Request, Response, Router } from '@xenosisorg/xenosis-core';
import { createChargeSchema, idParamSchema } from './charge.schema';

export default function ChargeController({ server, chargeService }) {
  const router = Router();

  /** @peer createCharge */
  router.route('/').post(
    Handler(Request.Body(createChargeSchema), async (body) => {
      return Response.Created(await chargeService.create(body));
    }),
  );

  /** @peer getCharge */
  router.route('/:id').get(
    Handler(Request.Params(idParamSchema), async ({ id }) => {
      return Response.OK(await chargeService.get(id));
    }),
  );

  server.use('/api/v1/charges', router);
}
```

The controller is a normal REST controller. Adding `/** @peer methodName */` above a route is the only signal Xenosis needs that the route should be reachable through `this.api.billing.methodName(...)`.

### Sync the API package

```bash
xenosis sync api billing
# ●  Found 2 @peer route(s): createCharge, getCharge
# 🎉 Updated @example/billing-api with 2 route(s).
```

The CLI rewrites the `routes: { ... }` block in the API package while leaving your type definitions, imports, and comments untouched. If `apis/billing-api` doesn't exist yet, the command scaffolds the package with a stub type.

### Consumer side — declare the binding

```jsonc
// users-service/xenosis.config.json
{
  "peers": {
    "billing": {
      "package": "@example/billing-api",
      "transport": "http",
      "baseUrl": "http://localhost:4002",
      "timeoutMs": 5000,
      "retry": { "attempts": 2, "backoffMs": 200 }
    }
  }
}
```

Each `peers.<name>` binding becomes `cradle.api.<name>` — a typed proxy that issues HTTP calls against the configured `baseUrl`, wrapped in the configured retry/timeout/circuit-breaker policy.

### Consumer side — call it like a local method

```ts
import type { BillingServiceApi } from '@example/billing-api';

export default class UserService {
  private api: { billing: BillingServiceApi };

  constructor({ api }: { api: { billing: BillingServiceApi } }) {
    this.api = api;
  }

  async upgrade(userId: string, amount: number) {
    return this.api.billing.createCharge({
      userId,
      amount,
      currency: 'USD',
    });
  }
}
```

Inject the `api` aggregator through awilix (it's a cradle key like any other), then call peers as if they were local methods. The proxy infers everything from `BillingServiceApi` — TypeScript rejects wrong argument shapes, missing fields, and incorrect return type assumptions at compile time.

### Path parameters

For `path: '/api/v1/charges/:id'`, the proxy extracts `id` from the input object, inserts it into the URL, and strips it from the body:

```ts
await this.api.billing.getCharge({ id: '85a7-...' });
// → GET http://billing/api/v1/charges/85a7-...
```

### Reliability and tracing

The proxy uses the same HTTP transport as the legacy `PeerClient` — per-binding retry, timeout, and circuit-breaker controls, plus automatic trace header propagation (`x-xenosis-trace-id`, `x-xenosis-span-id`) so end-to-end traces flow across hops.

### Service identity — `peerName`

Every peer call carries an `x-xenosis-caller` header identifying the caller. The value is the caller's `peerName` (falling back to `name`). Use the short form consistently — it's the same string used as the `peers.<name>` cradle key and in a callee's `boundaries.allowedCallers`:

```jsonc
// users-service/xenosis.config.json
{ "name": "users-service", "peerName": "users" }
```

`peerName: "users"` means: other services bind this peer as `peers.users`, call it as `this.api.users.*`, list `"users"` in their `boundaries.allowedCallers`, and see `x-xenosis-caller: users` on inbound requests. Keeping all four aligned is what makes boundaries and the dependency graph work.

### Boundaries — `allowedCallers`

A service can declare which **other services** may call it. This is enforced inbound: the callee checks the `x-xenosis-caller` on each request against its allowlist.

```jsonc
// billing-service/xenosis.config.json
{
  "boundaries": {
    "allowedCallers": ["users", "orders"]
  }
}
```

- A peer call whose `x-xenosis-caller` is **not** in the list → **403 Forbidden**.
- A request with **no** `x-xenosis-caller` (browser / public traffic) passes — boundaries only gate peer-to-peer calls.
- Omitting `boundaries` (or an empty list) leaves the service **open to all** (default, backward-compatible).

The check runs as the first middleware, before any route. Identity is the caller's `peerName` — there's no cryptographic proof, so this is a topology guardrail for a trusted internal network, not authentication. For a hard gate, combine it with [`authentication`](#12-authentication).

### Visualising the topology — `xenosis graph`

`xenosis graph` reads every service's config and prints who-calls-who plus an inline lint of boundary violations — a call to a peer whose `allowedCallers` doesn't include the caller:

```bash
$ xenosis graph

  billing
  calls: users
  allowedCallers: (open to all)

  notifications
  calls: orders, payments ✗
  allowedCallers: (open to all)

  payments
  calls: orders
  allowedCallers: orders

! 1 boundary violation(s) — a service calls a peer that does not allow it:
  notifications → payments: not in payments.boundaries.allowedCallers (orders)
```

Violations are reported as warnings (exit 0). Pass `--json` for machine-readable output (`{ services, violations }`) to wire into CI. This catches a misconfigured boundary at build/dev time, before it becomes a runtime 403.

### When to use the legacy `definePeerApi` / `mountPeerApi`

The older pattern (a shared package with `definePeerApi<T>` on one side and `mountPeerApi` on the other) is still exported. It's the right tool for **external API wrappers** — vendor APIs you don't own (Stripe, GitHub, …) where the routes table needs `bodyEncoding`, `errorMapper`, and custom headers per route. See section 13 (External APIs).

For internal services in your own monorepo, prefer `defineServiceApi` + `this.api.<name>`.

### Default exports

A peer package must default-export the `PeerApi` (i.e. `export default definePeerApi(...)`). A named export `peerApi` is accepted as a fallback. Anything else will fail at boot.

---

## 14. Peers — External APIs

Third-party APIs (Stripe, Twilio, GitHub, internal-legacy) follow the **same** `definePeerApi` contract but live under `examples/ts/apis/xenosis-custom/`. The folder name signals "user territory" — current and future CLI scaffolding treats it as off-limits for regeneration.

### The differences in one table

| | Internal peer | External peer |
|---|---|---|
| Lives in | `apis/<name>/` | `apis/xenosis-custom/<name>/` |
| Owner of the other end | your Xenosis service | third-party / out of your control |
| `external` flag | `false` (default) | `true` |
| Body encoding | `'json'` (default) | often `'form-urlencoded'` |
| Auth | `apiKey` → `x-xenosis-peer-key` | custom (`Authorization: Bearer …` via `headers`) |
| Error envelope | Xenosis `Exception` JSON | vendor-specific; mapped via `errorMapper` |

### A complete external API example

```ts
// packages/apis/xenosis-custom/httpbin-api/src/index.ts
import { definePeerApi, Exception } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

export interface HttpBinApi {
  echoPost(input: { amount: number; currency: string; note?: string }):
    Promise<{ form: Record<string, string>; headers: Record<string, string> }>;
  echoStatus(input: { code: number }): Promise<unknown>;
}

export const httpbinApi = definePeerApi<HttpBinApi>({
  name: 'httpbin',
  external: true,
  bodyEncoding: 'form-urlencoded',
  errorMapper: (status, body) => {
    if (status === 401) return Exception.Unauthorized(body);
    if (status === 402) return Exception.PaymentRequired(body);
    if (status === 403) return Exception.Forbidden(body);
    if (status === 418) return Exception.ImATeapot(body);
    if (status >= 500) return Exception.BadGateway(body);
    return Exception.BadRequest(body);
  },
  routes: {
    echoPost: {
      method: 'POST',
      path: '/post',
      bodySchema: z.object({
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        note: z.string().optional(),
      }),
    },
    echoStatus: {
      method: 'GET',
      path: '/status/:code',
      bodySchema: z.object({ code: z.number().int().min(100).max(599) }),
    },
  },
});

export default httpbinApi;
```

### Wiring into a service

```jsonc
{
  "peers": {
    "httpbin": {
      "package": "@example/httpbin-api",
      "transport": "http",
      "baseUrl": "https://httpbin.org",
      "timeoutMs": 10000,
      "headers": {
        "Authorization": "Bearer demo-token-abc",
        "X-Demo-Service": "users-service"
      }
    }
  }
}
```

```ts
class UserService {
  constructor(private deps: { httpbin: PeerClient<HttpBinApi> }) {}

  async echo(input: { amount: number; currency: string; note?: string }) {
    return this.deps.httpbin.echoPost(input);
    //   ^^^^^^^^^^^^^^^^^^^ form-urlencoded body + Bearer header sent transparently
  }
}
```

### Error mapping in practice

When the remote returns a non-2xx status, `httpTransport` throws `PeerHttpError(status, ...)`. The peer client catches it and, if the API has an `errorMapper`, calls it with the status and parsed body. The mapper's returned `Error` (typically a Xenosis `Exception`) is rethrown — your handler sees `Exception.PaymentRequired` for Stripe 402, etc.

If you don't provide an `errorMapper`, callers see the raw `PeerHttpError`.

### Custom body encoding

External APIs that use form-urlencoded (Stripe, Twilio, classic OAuth):

- Set `bodyEncoding: 'form-urlencoded'` on the `definePeerApi` (or override per binding via `peers.X.bodyEncoding`).
- Nested objects encode Stripe-style: `metadata[orderId]=123`.
- Arrays encode as `tags[]=a&tags[]=b`.

---

## 15. Reliability

Xenosis uses [cockatiel](https://github.com/connor4312/cockatiel) for retry, timeout, and circuit breaker. All three are configured per-peer in the binding.

### Defaults

| Setting | Default |
|---|---|
| `timeoutMs` | `5000` |
| `retry.attempts` | `0` (no retries) |
| `retry.backoffMs` | `200` |
| `retry.retryOnStatus` | `[502, 503, 504]` |
| `circuitBreaker` | off |
| `circuitBreaker.resetMs` | `30000` |

### Policy stack

The execution order (outermost first):

```
circuitBreaker → retry → timeout → transport call
```

- **Timeout** is innermost so each retry attempt has its own timer.
- **Retry** triggers on:
  - any thrown error (network failure, abort), OR
  - `PeerHttpError` with a status code in `retryOnStatus`.
- **Circuit breaker** opens after N consecutive failures and stays open for `resetMs` before going half-open.

### Example: aggressive policy for a flaky peer

```jsonc
{
  "peers": {
    "flakyBilling": {
      "package": "@example/billing-api",
      "transport": "http",
      "baseUrl": "http://billing:4002",
      "timeoutMs": 3000,
      "retry": {
        "attempts": 5,
        "backoffMs": 100,
        "retryOnStatus": [429, 502, 503, 504]
      },
      "circuitBreaker": {
        "failureThreshold": 10,
        "resetMs": 60000
      }
    }
  }
}
```

### Reliability is per-peer, not per-call

The policy is built once per binding at boot. All calls through `cradle.flakyBilling.*` share the same policy. If you need different policies for different methods on the same peer, declare two bindings pointing at the same package.

---

## 16. Tracing & Request Logging

Xenosis propagates a lightweight trace context across peer calls via three headers and uses it to thread a child logger through every request.

### Headers

- `x-xenosis-trace-id` — UUID identifying the trace
- `x-xenosis-span-id` — UUID for the current span
- `x-xenosis-parent-span-id` — UUID of the parent span (set on outbound peer calls)

### How it works (out of the box)

Every service automatically mounts a **request context middleware** ahead of user routes. For each incoming request the middleware:

1. Reads inbound `x-xenosis-trace-id` headers — or mints a fresh trace if none.
2. Creates an awilix **request scope** with `traceContext` and `requestLogger` cradle keys.
3. Echoes the trace headers on the response so the caller can correlate.
4. Wraps the rest of the request in `AsyncLocalStorage` so deep async code (peer clients, services) sees the active trace without explicit propagation.

When a service calls a peer through `cradle.<peer>.someMethod(...)`, the peer client automatically:

- Reads the active trace via `getActiveTraceContext()`.
- Creates a **child span** (new `spanId`, `parentSpanId` set to the current span).
- Sends the new context as outbound headers.

The receiving service picks it up in its own middleware. End-to-end you get a request log like:

```
[users-service]   request:end  traceId=… spanId=A parentSpanId=null method=POST path=/api/v1/users/.../upgrade status=200
[billing-service] request:end  traceId=… spanId=B parentSpanId=A    method=POST path=/api/v1/charges status=200
```

Same `traceId`, billing's `parentSpanId` matches users' `spanId`. That's a complete distributed trace, no OTel required (although OTel adapter is planned for v0.2).

### Configurable request logging

In `xenosis.config.json`:

```jsonc
{
  "requestLog": "end"   // "start" | "end" | "both" | "off"
}
```

- `"end"` *(default)* — one log line on `res.finish` with `status` and `durationMs`.
- `"start"` — log when the request hits the middleware. No status / duration.
- `"both"` — both lines per request.
- `"off"` — middleware is still mounted (it still sets up trace context and scope), but no request log lines are emitted.

### Accessing the active context manually

For code that runs inside a request but doesn't get the cradle injected (utility functions, background callbacks):

```ts
import { getActiveTraceContext, getRequestContext } from '@xenosisorg/xenosis-core';

function someUtil() {
  const trace = getActiveTraceContext();
  if (trace) {
    // …trace.traceId, trace.spanId, trace.parentSpanId
  }

  const ctx = getRequestContext();
  if (ctx) {
    ctx.logger.info({ extra: 'field' }, 'something happened');
  }
}
```

Outside a request both helpers return `undefined`.

### Pino under the hood

The root logger is [pino](https://github.com/pinojs/pino):

- Production (`config.env === 'production'`): pure JSON to stdout (no transport overhead).
- Anything else: pretty-printed via `pino-pretty` with colours and ISO timestamps.

Set the level in config:

```jsonc
{
  "logLevel": "info"   // fatal | error | warn | info | debug | trace | silent
}
```

The `service` field is added to every log line automatically (taken from `config.name`).

### Child loggers

Every service that injects `requestLogger` gets a Pino child bound to `{ traceId, spanId, parentSpanId, method, path, service }`. Anything you log through it inherits those fields:

```ts
class UserService {
  constructor(private deps: { requestLogger: ILogger }) {}

  async create(input: CreateUserInput) {
    this.deps.requestLogger.info({ email: input.email }, 'creating user');
    // → traceId, spanId, method, path, email, msg='creating user'
  }
}
```

`requestLogger` is scoped per request; the singleton `logger` cradle key still works for boot-time / background logs but is **not** bound to a trace.

### Where trace ids show up

Once a trace id is on the wire, three places consume it — you don't have to wire anything yourself:

- **Service logs.** Every Pino line emitted under a request includes `traceId` (and `spanId`) as a structured field. `grep traceId <file>` works for offline post-mortems.
- **[Dev dashboard — Traces tab](#19-dev-dashboard).** While `xenosis dev` is running, every peer call carrying a trace id lands in an in-memory store. The dashboard renders the trace as a waterfall, with redacted request/response bodies and every log line that mentioned the id, sorted across services on one time axis. Five-minute window; live SSE updates.
- **[MCP `explain_trace`](#18-mcp-server-ai-tooling).** The same trace, but structured for an LLM. Claude / Cursor can read the timeline + bodies + log correlation and answer "why did this trace fail?" without you grepping anything.

Together they make the old "`grep traceId services/*/logs` by hand" ritual unnecessary — pick the surface that matches the question, the trace id resolves the same data in each.

### Peer call telemetry — what gets recorded

The peer client wraps every call in a fire-and-forget `PeerCallEvent` emit. The event carries the trace correlation, timing, status, error name, and redacted request/response bodies (capped at 8 KB). Emission is gated on `XENOSIS_TELEMETRY_URL` — `xenosis dev` sets it for the dashboard's collector, production builds leave it unset and the emit is a single guard check.

```ts
// Re-exported from @xenosisorg/xenosis-core
import type { PeerCallEvent } from '@xenosisorg/xenosis-core';

// {
//   __schema_version: 1,
//   kind: 'peer-call',
//   from: 'orders', to: 'payments',
//   method: 'charge', httpMethod: 'POST', path: '/api/v1/charges',
//   status: 200, ok: true, durationMs: 87,
//   requestBody: { amount: 4200, currency: 'USD', token: '<redacted>' },
//   responseBody: { id: 'ch_42', status: 'completed' },
//   traceId: '...', spanId: '...', parentSpanId: '...',
//   ts: 1779819062462,
// }
```

Two layers of redaction (`token`, `secret`, `password`, `apiKey`, `jwtSecret`, `authorization` — case-insensitive — plus URL credentials in connection strings) apply before any of this reaches the dashboard storage or the MCP wire, so an LLM never sees a raw token.

---

## 17. Testing

`@xenosisorg/xenosis-testing` boots a service **in-process** for tests: real controllers, real DI container, the real schema on an **in-memory Postgres (PGlite)** — no Docker, no network, no migration CLI. Peer calls are replaced with mocks; HTTP routes are driven with `supertest` without opening a port.

```bash
pnpm add -D @xenosisorg/xenosis-testing @electric-sql/pglite supertest vitest
```

### The layout — `__tests__/` per service

```
my-service/
├── __tests__/
│   ├── test.config.json     # test-only config delta
│   ├── setup.ts             # setupTestApp() + default peer mocks
│   └── charge.test.ts       # the tests
└── vitest.config.ts         # include: __tests__/**
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['__tests__/**/*.test.ts'] } });
```

### `createTestContainer({ serviceRoot })` — auto mode

Point at the service directory; the kit reads `xenosis.config.json` (layered with `__tests__/test.config.json`), boots an in-memory engine per `schemas` binding and replays its migrations, then autoloads repositories/services/controllers by the standard convention.

```ts
import { createTestContainer } from '@xenosisorg/xenosis-testing';

const ctx = await createTestContainer({
  serviceRoot: new URL('..', import.meta.url).pathname,
});
// ctx.container — the awilix container
// ctx.cradle    — read clients/services off it
// ctx.server    — the live Express app (pass to supertest, no listen)
// ctx.cleanup() — tears down in-memory engines + clients
```

### `test.config.json` — a delta, not a replica

Holds **only what the test changes**; everything else (peers, schemas, boundaries) is inherited from the service's real `xenosis.config.json`, so the two can't drift. An optional `extends` points at a different base.

```jsonc
// __tests__/test.config.json
{
  "authentication": { "enabled": false },
  "requestLog": "off"
}
```

### Peer mocks

Replace the services this one calls — no other service needs to run. Each key is exposed as both `cradle.<name>` and `cradle.api.<name>`, so a service can inject either `this.api.billing` or `billing`.

```ts
const ctx = await createTestContainer({
  serviceRoot,
  peers: {
    users: { list: async () => [{ id, email, name, createdAt }] },
    billing: { createCharge: async (i) => ({ id: 'ch_1', ...i }) },
  },
});
```

Mocks are plain functions, so they can branch on input, throw to simulate failures, or assert on arguments.

### Real database in memory — PGlite + `seed`

For services backed by a Prisma schema package, the kit runs the genuine Prisma client against an in-memory Postgres. The schema package exposes an optional `createTestClient(handle)` (the kit boots PGlite, replays `prisma/migrations/*.sql`, and hands the live instance over to be wrapped in a driver adapter). Seed before the test, then read/write real SQL:

```ts
const ctx = await createTestContainer({
  serviceRoot,
  seed: async ({ mainDb }) => {
    await mainDb.user.create({ data: { email: 'a@b.com', name: 'A' } });
  },
});

const db = ctx.cradle.mainDb;     // a real Prisma client
await db.user.count();            // real SELECT against PGlite
```

The schema is real — unique constraints, foreign keys, indexes all enforce. A fresh PGlite is created per call, so tests are isolated. No mock client to drift from production.

### Driving the service — two ways

**1. Raw HTTP with supertest** — assert the wire contract (status code, headers, body shape):

```ts
import request from 'supertest';

await request(ctx.server)
  .post('/api/v1/charges')
  .send({ userId, amount: 4200, currency: 'USD' })
  .expect(201);
```

**2. The typed client with `ctx.client(apiSpec)`** — call the service through its own `defineServiceApi` contract, exactly as a sibling service would (`api.billing.createCharge(...)`), but in-process. Same Proxy + zod validation + path-param resolution as production; fully type-safe; no port:

```ts
import billingApi from '@example/billing-api';

const billing = ctx.client(billingApi);
const charge = await billing.createCharge({ userId, amount: 4200, currency: 'USD' });
// charge.status is 'completed', charge.amount is number — inferred from the contract.
expect(charge).toMatchObject({ status: 'completed', amount: 4200 });
```

Non-2xx responses surface as a thrown error (with `status`/`body`), so `await expect(client.x()).rejects.toThrow()` works. Use supertest when you care about the HTTP envelope; use `ctx.client` when you want to test the same typed surface your callers consume.

A full suite driven entirely through the typed client — note `getCharge({ id })` resolves the `:id` path param automatically, just like a real peer call:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import billingApi from '@example/billing-api';
import { setupTestApp } from './setup';

describe('billing via typed client', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;

  beforeAll(async () => { ctx = await setupTestApp(); });
  afterAll(() => ctx.cleanup());

  it('creates then reads a charge', async () => {
    const billing = ctx.client(billingApi);   // fully typed from the contract

    const created = await billing.createCharge({
      userId: TEST_USER.id, amount: 4200, currency: 'USD',
    });
    expect(created.status).toBe('completed');

    // GET /api/v1/charges/:id — the client puts `id` into the path, not the body.
    const fetched = await billing.getCharge({ id: created.id });
    expect(fetched.id).toBe(created.id);
  });

  it('throws when the charge does not exist', async () => {
    await expect(ctx.client(billingApi).getCharge({ id: 'missing' })).rejects.toThrow();
  });
});
```

### `setupTestApp` — the fixture pattern

Centralise `serviceRoot` and default peer mocks in `__tests__/setup.ts` so tests override only what they need (peer mocks merge per-peer):

```ts
// __tests__/setup.ts
import { createTestContainer, type CreateTestContainerOptions } from '@xenosisorg/xenosis-testing';

const defaultPeers = {
  users: { list: async () => [{ id: '…', email: 'buyer@example.com', name: 'Buyer', createdAt: new Date() }] },
};

export function setupTestApp(overrides: CreateTestContainerOptions = {}) {
  const { peers: o = {}, ...rest } = overrides;
  const peers = { ...defaultPeers };
  for (const [name, impl] of Object.entries(o)) peers[name] = { ...(peers[name] ?? {}), ...impl };
  return createTestContainer({
    serviceRoot: new URL('..', import.meta.url).pathname,
    peers,
    ...rest,
  });
}
```

```ts
// __tests__/charge.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import request from 'supertest';
import { setupTestApp } from './setup';

describe('billing-service: POST /api/v1/charges', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  beforeAll(async () => { ctx = await setupTestApp(); });
  afterAll(() => ctx.cleanup());

  it('charges a known user', async () => {
    await request(ctx.server)
      .post('/api/v1/charges')
      .send({ userId: '…', amount: 4200, currency: 'USD' })
      .expect(201);
  });

  it('rejects an unknown user', async () => {
    const empty = await setupTestApp({ peers: { users: { list: async () => [] } } });
    await request(empty.server).post('/api/v1/charges').send({ /* … */ }).expect(500);
    await empty.cleanup();
  });
});
```

### API surface

| Export | What it does |
|---|---|
| `createTestContainer(options)` | Boot a service in-process. `serviceRoot` (auto) or explicit `config`/`schemas`/`autoload`. Returns `{ container, cradle, server, client, cleanup }`. |
| `ctx.server` | The live Express app — pass to `supertest`, no `listen`. |
| `ctx.client(apiSpec)` | A typed client for the service's own `defineServiceApi` contract, routed in-process. Call `ctx.client(billingApi).createCharge(...)`. |
| `options.peers` | Per-peer mock map → `cradle.<name>` + `cradle.api.<name>`. |
| `options.seed(cradle)` | Run after clients are ready; seed the in-memory DB. |
| `options.register` | Extra `asValue` cradle registrations. |
| `resolveTestConfig(serviceRoot)` | Merge `xenosis.config.json` + `__tests__/test.config.json` manually. |
| `replayPrismaMigrations(path, exec)` | Apply `prisma/migrations/*.sql` onto any SQL engine. |

> **Note (prototype).** The in-memory engine currently covers `postgres`/`prisma` (PGlite). Mongo/Redis/Dynamo throw a clear "not implemented yet". A schema package opts in by exposing `createTestClient` (see `examples/ts/db-schemas/psql-main`).

---

## 18. MCP Server (AI tooling)

`@xenosisorg/xenosis-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants (Claude Code, Claude Desktop, Cursor, …) **read-only context about your specific Xenosis workspace** — peer graph, parsed service configs (secrets redacted), live health checks, and OpenAPI specs of running services.

It does **not** generate code. CLI scaffolding already does that deterministically. The MCP server is the layer that lets an AI answer questions about *your project*, not Xenosis in general — e.g. "why does `orders-service` get a 403 from `payments`?" The AI calls `get_peer_graph`, sees the violation, calls `get_service_config payments` to confirm `boundaries.allowedCallers`, and points out the mismatched `peerName`. Data comes from your files, not hallucination.

### Enable it

In a new project, `create app` prompts you (default: yes). In an existing project, run once:

```bash
xenosis init mcp
```

That writes `.mcp.json` at the workspace root:

```json
{
  "mcpServers": {
    "xenosis": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@xenosisorg/xenosis-mcp"]
    }
  }
}
```

Commit `.mcp.json` to git so your team picks it up on clone. Most AI clients prompt to **trust** project-scope MCP servers on first load — approve once and it stays.

Restart your AI client and verify:

> List the MCP tools available from xenosis.

You should see six tools.

### The six tools

The first four are stateless workspace introspection — they read your config files. The last two are **Phase 2**: they sit on top of the live [dev dashboard](#19-dev-dashboard) to give the AI runtime context.

| Tool | Purpose | Requires services running? |
| --- | --- | --- |
| `get_peer_graph` | Full peer mesh + boundary violations (same data as `xenosis graph --json`). | No |
| `get_service_config` | Parsed `xenosis.config.json` of one service with secrets redacted. | No |
| `health_check` | `GET /healthcheck` on each service's local port — up/down. | Yes (`xenosis dev`) |
| `get_openapi_spec` | OpenAPI 3.1 spec of a running service (route summary by default; `full: true` for the whole document). | Yes (`xenosis dev`) |
| `explain_trace` | Correlated timeline of every peer call + log line under one `x-xenosis-trace-id`, with redacted request/response bodies. | Yes (`xenosis dev`) |
| `simulate_change` | Blast radius of a proposed change: callers from the peer graph, boundary verdict, and whether a new `addCaller` would currently be refused. | No |

`get_service_config` accepts the `peerName`, `config.name`, or the service directory name — whichever the caller happens to know.

#### `explain_trace(traceId)` — Phase 2

Every peer call your services make carries an `x-xenosis-trace-id`; the [dashboard's trace store](#19-dev-dashboard) keeps the last five minutes of those events with redacted bodies, and `explain_trace` hands the model a structured timeline of one of them:

- Calls ordered by start time, each with a `ms-offset` from the earliest event in the trace.
- Request and response bodies (redacted + truncated at 8 KB).
- The `firstFailure` pointer — first call that did not return `ok`.
- Every log line, across services, that mentioned the same trace id (pino structured fields and pretty-printed dev output are both matched).

Useful prompt — after a curl that fails mid-flow:

> Why does `orders` get a 422 from `payments` on trace `abc123`?

The AI reads the timeline, names the failing hop, and uses the `errorName` + upstream payload to suggest a fix. The earlier "grep across five services by trace id" workflow becomes a single chat turn.

Honeycomb's BubbleUp and Datadog's Watchdog do something similar over millions of traces with ML and a paid subscription. Xenosis does it deterministically over your graph — the contracts are typed, the trace ids already propagate, and the data never leaves `localhost` except as redacted MCP responses.

#### `simulate_change({ service, addCaller? })` — Phase 2

Static blast-radius helper. Given a proposed change to a service:

- Returns every **caller** that declares the target as a peer.
- Returns the target's current `boundaries.allowedCallers` (or `openToAll`) and any *existing* violations into it.
- If you pass `addCaller`, returns a verdict: would it currently be refused? If yes, the exact patch needed (add the caller to the target's allow-list).
- Returns the `peerPackages` each caller uses, as a grep hint for where consumer-side code lives.

Use it **before** proposing edits to a service's request schema or boundary list, so the AI can name every caller that will need updating in the same PR rather than discovering them one failed run at a time. No TypeScript compiler API integration here — codemod generation is Phase 3 on the [roadmap](#21-roadmap).

### What it reads

- The workspace's `xenosis.workspace.json` (to locate `structure.services`).
- Each `<services>/*/xenosis.config.json` — service identity, peers, boundaries, port, OpenAPI config.
- Each running service's `/healthcheck` and `/openapi.json` over `http://localhost:<port>`.

Nothing outside the workspace; no writes; no network beyond `localhost`.

### Privacy — secret redaction

`get_service_config` redacts any property whose key matches `token | secret | password | apiKey | api_key | jwtSecret` (case-insensitive) and masks inline credentials in URL strings (`postgres://user:<pw>@host` → `postgres://user:<redacted>@host`). The AI never sees real secrets through this tool, even if your `xenosis.config.json` contains them inline.

### Where this matters

In editors with file access (Cursor, Claude Code in VS Code), MCP doesn't grant the AI *new abilities* — it could read configs itself. But:

- **It's faster and more accurate.** One `get_peer_graph` call returns a pre-built mesh with violations instead of the AI grepping 13 configs and ranking what it found.
- **Conventions are normalised.** `peerName` vs `name` vs directory name is a common gotcha; the MCP server accepts any of them.
- **Secrets stay hidden.** Direct file reads send raw `xenosis.config.json` to the model. The MCP tool redacts first.

In editors *without* file access (Claude Desktop, Claude.ai web with MCP), the server adds the capability outright — workspace-aware answers that would otherwise be hallucinations.

### Manual client setup (non-`init mcp`)

`.mcp.json` is the [project-scope MCP](https://modelcontextprotocol.io/docs/concepts/transports) format. Cursor and Claude Code (CLI + VS Code) pick it up automatically when you open the workspace. For **user-scope** setup (server available across every project):

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```jsonc
{
  "mcpServers": {
    "xenosis": {
      "command": "npx",
      "args": ["-y", "@xenosisorg/xenosis-mcp"],
      "env": {
        "XENOSIS_WORKSPACE_ROOT": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

`XENOSIS_WORKSPACE_ROOT` pins the workspace because Claude Desktop launches the server from an unpredictable cwd. Project-scope `.mcp.json` doesn't need it — the client cd's into the project first.

**Claude Code CLI** (global):

```bash
claude mcp add xenosis npx -y @xenosisorg/xenosis-mcp --scope user
```

---

## 19. Dev Dashboard

Run `xenosis dev` and a zero-setup dashboard comes up at `http://localhost:9000`. It reads the same data your services already produce — peer graph, health, traces, logs — and surfaces it in three views you can switch between with the toggle in the header.

```
$ xenosis dev
→ Starting 13 services…
  • billing-service
  • orders-service
  • …
→ Dashboard: http://localhost:9000
```

Three views, one URL. Each is reachable directly via the hash so a refresh keeps you where you were:

- `localhost:9000/#cards` — service cards (default)
- `localhost:9000/#graph` — heat-mapped peer graph
- `localhost:9000/#traces` — trace waterfall

### Cards view

One card per service. Click a card to expand it and reveal:

- **Calls** — peers this service declares (with a red `✗ violation` badge if any callee's `allowedCallers` list forbids it).
- **Called by** — services that declare this one as a peer.
- **Show logs** — opens a side panel streaming this service's stdout/stderr over SSE. Backfills the last 200 lines from a ring buffer; new lines arrive live.

Click a peer pill inside an expanded card to jump to that service's card.

### Graph view — live heat map

The same peer mesh drawn as a circular graph with edges colour- and width-coded by live telemetry. Every peer call your services make emits a `PeerCallEvent` (see [§ 16 Tracing](#16-tracing--request-logging)); the dashboard aggregates them over a 60-second sliding window and redraws.

| Dimension | What it shows |
| --- | --- |
| Edge width | Call volume over the last 60s (log-scaled so a hot edge doesn't dwarf the rest) |
| Edge colour | p95 latency — green <100 ms, yellow 100–500 ms, red >500 ms |
| Dashed red animation | Circuit breaker open or retry burst on that edge |
| Pulsing node border | Service has at least one outbound edge in breaker / retry state |
| Red dashed line | Static boundary violation (one service calls a peer not in its `allowedCallers`) |

Telemetry is opt-in via the `XENOSIS_TELEMETRY_URL` env var. `xenosis dev` sets it on every service it spawns, so the heat map lights up automatically while you develop. In production builds the env var is unset and the emitter is a single guard check — zero runtime cost.

#### Manual refresh, not background polling

Health checks (the up/down dot on each card / node) run **only on initial load and when you click Refresh** in the header. An earlier version polled every 2 seconds and filled every service's stdout with `/healthcheck` request logs — quiet logs are worth one click.

### Traces view — Jaeger-lite, zero setup

Every peer call carries an `x-xenosis-trace-id`. The dashboard keeps the last 5 minutes of traces in memory (capped at 200 distinct trace ids, LRU-evicted), indexed by id, and surfaces them in a waterfall that doesn't need Jaeger, Tempo, or an OTel collector.

What it shows:

- **Left panel** — newest-first list of recent traces. Each shows the entry call (e.g. `orders → cart.getCart`), call count, total duration, and a red border if any call failed.
- **Waterfall** — one row per peer call, positioned on a millisecond time axis. Bar colour matches the heat-map rules (green / yellow / red); failed calls get a red diagonal stripe. Click any row to open its detail.
- **Body inspector** — the selected call's request and response bodies, redacted for secrets and capped at 8 KB. Auto-selects the first failure when you open a trace so you land on the problem.
- **Correlated logs** — every log line, across services, that mentioned this trace id.

The list updates over SSE as new traces arrive — the server broadcasts a debounced summary (max one per trace id every 250 ms) so a 50-request burst becomes one tidy update rather than a flood.

#### Privacy — secrets stay hidden

Bodies are redacted at **two layers**:

1. In the service, before the telemetry event leaves the process (`redactBody` in the peer client).
2. At the dashboard's storage boundary, before anything is persisted to the trace store.

Any property whose key matches `token | secret | password | apiKey | api_key | jwtSecret | authorization` (case-insensitive) is replaced with `<redacted>`. Inline URL credentials (`postgres://user:pw@host`) are masked to `postgres://user:<redacted>@host`. The same rules apply to MCP `explain_trace` output — an LLM never sees a raw token through the dev pipeline.

### CLI flags

```bash
xenosis dev                  # dashboard on http://localhost:9000
xenosis dev --ui-port 9100   # custom port
xenosis dev --no-ui          # logs only, dashboard disabled
```

### HTTP API

The dashboard's data is also reachable directly. Useful for scripting and for the [MCP server](#18-mcp-server-ai-tooling) (which calls `/api/trace/:id` to power `explain_trace`).

| Endpoint | Returns |
| --- | --- |
| `GET /api/state` | Graph + services with status and live edges. |
| `GET /api/traces` | Newest-first summary list (last 5 min, capped at 50). |
| `GET /api/trace/:id` | Full calls + correlated logs for one trace id. |
| `GET /api/logs/:name` | Ring-buffer backfill of a service's last 200 log lines. |
| `POST /api/refresh` | Manually re-run health checks; results stream over SSE. |
| `POST /api/telemetry` | Ingest endpoint for `PeerCallEvent`s — what services POST to. |
| `GET /api/stream` (SSE) | Events: `snapshot`, `status`, `edges`, `trace`, `log`. |

### Try it

Inside the [`examples/ts`](./examples/ts) workspace:

```bash
# Terminal 1
xenosis dev

# Terminal 2 — generate traffic across the checkout flow
for i in {1..30}; do
  curl -s -X POST localhost:4018/api/v1/orders \
    -H 'content-type: application/json' \
    -d '{"userId":"user-42"}' > /dev/null
done

# Then in another terminal — drop a peer mid-burst to see the heat
pkill -f services/payments-service
```

Watch `orders → payments` turn red and start pulsing in the Graph view, click into Traces, and the waterfall pinpoints the first failed hop.

---

## 20. Examples

The monorepo ships a full e-commerce workspace: **13 TypeScript services** plus a parallel JavaScript service, twelve internal API packages, one external API wrapper, a Prisma schema package, and three shared modules. The services form a realistic peer mesh; one path — **checkout** — is implemented end to end across five of them.

### The checkout flow (real, end-to-end)

`POST http://localhost:4018/api/v1/orders` on `orders-service` fans out across four peers over the typed `this.api.*` proxy — every hop carries the same trace context, so the chain shows as one trace:

```
orders.createOrder(userId)
  → cart.getCart(userId)            # line items
  → pricing.quote(lines)            # subtotal + tax + total
  → payments.charge(orderId, …)     # capture — then calls back:
      → orders.markPaid(orderId)    # reverse leg (payments → orders)
  → notifications.orderConfirmed(…) # tell the user
```

`payments.charge` succeeds only because `orders` is in payments' `boundaries.allowedCallers`; the reverse `markPaid` call lands back on orders. Start everything with `xenosis dev`, then `curl -XPOST localhost:4018/api/v1/orders -H 'content-type: application/json' -d '{"userId":"u1"}'` — the response is a `paid` order, and the prefixed logs show the full chain.

### Services

| Service | Port | Calls | Role |
|---|---|---|---|
| `users-service` (TS) | 4001 | billing | Canonical layout — autoload, Prisma schema, JWT auth, `this.api.billing.*` |
| `billing-service` (TS) | 4002 | users | Charges; `@peer` controllers synced via `xenosis sync api`; has a `__tests__` suite |
| `orders-service` (TS) | 4018 | cart, pricing, payments, notifications | Checkout orchestrator + `markPaid` callback |
| `cart-service` (TS) | 4017 | — | Returns line items for a user |
| `pricing-service` (TS) | 4016 | — | Quotes a basket (subtotal + tax) |
| `payments-service` (TS) | 4013 | orders | Captures a charge, calls `orders.markPaid` back — `allowedCallers: [orders]` |
| `notifications-service` (TS) | 4022 | — | Sends the order confirmation |
| `catalog-service` (TS) | 4014 | — | Product catalog (stub) |
| `inventory-service` (TS) | 4015 | catalog | Stock; `allowedCallers: [cart, orders, shipping]` (stub) |
| `shipping-service` (TS) | 4019 | orders, inventory | Fulfilment (stub) |
| `reviews-service` (TS) | 4020 | catalog, orders | Reviews; `allowedCallers: [search]` (stub) |
| `search-service` (TS) | 4021 | catalog, reviews | Aggregates catalog + reviews (stub) |
| `playground-service` (TS) | 4010 | httpbin | External peer integration (form-urlencoded, Bearer, `errorMapper`) |
| `users-service-js` (JS) | 4011 | billing | JavaScript mirror (JSDoc-typed DI), same TS schema package |

The five checkout services are implemented for real (in-memory stores); the four marked _stub_ exist to make the peer graph and `xenosis graph` lint meaningful.

### Boundaries & graph

Three services restrict their callers via `boundaries.allowedCallers`: `payments` (only `orders`), `inventory` (`cart`/`orders`/`shipping`), `reviews` (only `search`). `xenosis graph` prints the whole mesh and lints any call that violates a boundary — see [§13 Peers](#13-peers--internal-rpc).

### Schema packages

| Package | Type | Models / notes |
|---|---|---|
| `@example/psql-main` | Prisma over Postgres (TS) | `User`, `Order`; ships `createTestClient` for in-memory tests |
| `@example/psql-events-js` | Prisma over Postgres (JS wrapper) | `Event` |

### Service API packages (internal RPC)

Every service has a matching `defineServiceApi` contract under `apis/<name>-api` — twelve internal packages (`users`, `billing`, `orders`, `cart`, `pricing`, `payments`, `notifications`, `catalog`, `inventory`, `shipping`, `reviews`, `search`). A few in use:

| Package | Provider | Consumed by |
|---|---|---|
| `@example/orders-api` | `orders-service` | `payments` calls `this.api.orders.markPaid(...)` |
| `@example/billing-api` | `billing-service` | `users-service` calls `this.api.billing.createCharge(...)` |

Kept in sync by `xenosis sync api <service>` reading `/** @peer */` directives in the controllers.

### External API packages

| Package | Type | Used by |
|---|---|---|
| `@example/httpbin-api` | `definePeerApi` + `mountPeerApi` (xenosis-custom) | `playground-service` consumes httpbin.org |

### Shared modules (workspace-wide singletons)

| Package | Style | What it does |
|---|---|---|
| `@example/whitelabel` | class | Branding config, loaded once at boot |
| `@example/resolve-user` | function (per-request) | Reads JWT payload, exposes typed `currentUser` resolver |
| `@example/resolve-tenant` | function (per-request) | Reads tenant header, exposes typed tenant resolver (TS + a JS mirror) |

See [examples/README.md](./examples/README.md) for the end-to-end walkthrough.

---

## 21. Roadmap

### v0.1 — Shipped

| Item | Notes |
|---|---|
| `xenosisBootstrap` + awilix DI | Destructured constructor injection, no decorators |
| Five connector providers (psql / mysql / mongo / dynamo / redis) | Single-schema fallback |
| Multi-schema loader (`schemas` config block) | One schema package shared by many services |
| Schema package convention | `createClient(connector)` + `schema` metadata |
| Autoload (glob + naming + `__xenosis` override) | Arbitrary categories (jobs, workers, gateways…) |
| REST layer (`Handler`, `Response`, `Exception`, `Request`) | Selector + handler pattern |
| OpenAPI 3.1 + Swagger UI | Auto-generated from controllers + zod; `.returns(schema)` for responses; `/openapi.json` + `/docs` |
| Service-API peers (`defineServiceApi` + `this.api.<name>`) | Routes kept in sync with controllers via `@peer` JSDoc + `xenosis sync api` |
| External API peers (`xenosis-custom/`, `errorMapper`, form encoding) | `definePeerApi` + `mountPeerApi` retained for vendor wrappers |
| Boundaries (`boundaries.allowedCallers`) | Inbound peer allowlist enforced via `x-xenosis-caller`; default open |
| Built-in auth gate (`authentication`) | Config-only shared-token gate (header or `?authToken`); `/healthcheck` exempt |
| Dependency graph (`xenosis graph`) | Prints who-calls-who + lints boundary violations (`--json`) |
| `@xenosisorg/xenosis-cli` | Scaffolding + parallel dev runner |
| Multi-ORM schema templates | Prisma (postgres / mysql), Drizzle, Knex, Mongo, Dynamo |
| TypeScript + JavaScript variants | `--lang js` for service / shared-module / schema-prisma-postgres |
| Graceful shutdown | SIGTERM/SIGINT drains HTTP listener → peers → schemas, configurable timeout |
| Production bundle | `xenosis generate manifest` emits a static-import map so autoload survives `tsup` / `esbuild` |
| Docs site | Astro + Tailwind, dark/light theme, interactive workspace explorer |
| Tracing & request logging | `x-xenosis-trace-id`, AsyncLocalStorage, Pino child loggers |
| Pino structured logger | JSON in prod, pretty in dev |
| Auth pattern | Express middleware + JWT + `currentUser` in request scope |
| Examples | 4 services (3 TS + 1 JS), 2 schemas, 2 service APIs, 1 external API, 4 shared modules |

#### CLI commands shipped in v0.1

| Command | Purpose |
|---|---|
| `npx create-xenosis-app <name>` | Bootstrap a new monorepo (pnpm-workspace.yaml, root tsconfig, scaffold) |
| `xenosis create service <name>` | Scaffold a service with full layout (autoload, healthcheck, sample CRUD). `--lang ts\|js`. |
| `xenosis create api <name>` | Scaffold an internal `@example/<name>-api` shared package |
| `xenosis create api <name> --external` | Scaffold an external API wrapper under `apis/xenosis-custom/<name>/` |
| `xenosis create schema <name> --orm <prisma\|drizzle\|knex\|mongo\|dynamo>` | Scaffold a schema package; `--db postgres\|mysql` when relevant. `--lang ts\|js` (Prisma postgres only). |
| `xenosis create shared-module <name>` | Scaffold a workspace-wide cradle singleton. `--style class\|function`, `--lang ts\|js`. |
| `xenosis sync api <service>` | Regenerate `apis/<service>-api/src/index.ts` from `/** @peer methodName */` directives. Creates the API package if it doesn't exist. |
| `xenosis create test <service>` | Add the `__tests__` scaffold (setup + supertest + test.config.json + vitest.config) to an existing service |
| `xenosis graph` | Print the peer dependency graph and lint `boundaries.allowedCallers` violations (`--json` for CI) |
| `xenosis generate manifest` | Emit `src/.xenosis-manifest.ts` so autoload survives a production bundler |
| `xenosis dev` | Run all services in parallel with prefixed logs and watch propagation across schema + API packages |
| `xenosis init mcp` | Write `.mcp.json` so AI clients (Claude / Cursor / Claude Desktop) get workspace-aware tools via `@xenosisorg/xenosis-mcp` |

> **Migrations.** Xenosis intentionally has no `migrate` command. Each schema package owns its migrations using the underlying ORM's CLI directly (`prisma migrate dev`, `drizzle-kit push`, `knex migrate:latest`, …). Wrapping every ORM's migrate semantics would re-invent each tool and lose features (shadow databases, drift detection, seed hooks). Run the ORM CLI through `pnpm --filter <schema-pkg> exec`.

#### How graceful shutdown works (shipped)

`Commands.start()` registers SIGTERM and SIGINT handlers. On signal the runtime:

1. Stops accepting new connections (`server.close()`).
2. Drains every peer-disconnect callback (`peerDisconnects` cradle).
3. Drains every schema-disconnect callback (`schemaDisconnects` cradle).
4. Exits with code 0 if drain completes within `config.shutdown.timeoutMs` (default 10s), otherwise exits with code 1.

#### How the production bundle path works (shipped)

`xenosis generate manifest` scans the autoload glob patterns (or the ones passed via `--patterns`) and emits `src/.xenosis-manifest.ts` with a static-import map. When that file is present, the autoload loader uses it instead of runtime `glob` — so a bundled service (tsup, esbuild) resolves every autoloaded module from a statically-analysable import graph.

```bash
xenosis generate manifest
pnpm exec tsup src/service.ts --format esm
```

### v0.2 — In progress (pub/sub and events)

#### RabbitMQ transport (`@xenosisorg/transport-rabbitmq`)

The first real pub/sub transport. Adds two new peer styles to the existing RPC client:

```ts
constructor(private deps: {
  events: PeerPublisher;
  orders: PeerSubscriber;
}) {
  this.deps.orders.subscribe('order.placed', async (event) => {
    // …
  });
}

await this.deps.events.publish('user.created', { userId: '...' });
```

Config sample:

```jsonc
{
  "peers": {
    "events": {
      "transport": "rabbitmq",
      "url": "amqp://localhost",
      "exchange": "events"
    }
  }
}
```

Per-event guarantees:
- At-least-once delivery (manual ack on subscriber side)
- Dead-letter queue per subscription
- Correlation ID propagation alongside trace headers

#### Inter-service auth (`@xenosisorg/peers-auth`)

Two pieces already ship in v0.1: `boundaries.allowedCallers` (inbound peer allowlist via `x-xenosis-caller`) and the `authentication` shared-token gate. These are topology/secret guardrails for a trusted network, not cryptographic proof. This add-on hardens them for hostile networks:

- Signed `x-xenosis-caller` (HMAC/JWT) so caller identity can't be spoofed
- Shared secret API key verification (the `apiKey` config field is sent today but not verified inbound)
- JWT signed by gateway (verify on every inbound peer call)
- mTLS (cert paths in config)

### v0.3 — AI-native developer experience

Built on the runtime signals Xenosis already produces — typed peer graph, traces, zod schemas, boundaries. The goal: surface introspection that competitors have to reconstruct from passive telemetry.

> **MCP Phase 2 has shipped** as part of the [MCP server](#18-mcp-server-ai-tooling) and the [Dev dashboard](#19-dev-dashboard) — `explain_trace` and `simulate_change` are documented there. What follows is the rest of v0.3.

#### CI graph diff — "you broke the contract"

A pre-commit / PR check that compares the peer mesh + zod schema hashes between branches:

```
$ xenosis graph diff main
✗ users → billing.charge: request schema changed
  + Added required field idempotencyKey: string
  3 callers will break: orders-service, retries-service, admin-cli
```

What Wundergraph Cosmo does for federated GraphQL and Buf for protobuf — but for type-safe HTTP RPC, no SaaS broker. Lives in the same workspace as the code; cheap to wire into any CI.

#### Time-Travel Peer Replay

Every dev-mode peer call is captured (request, response, timing, trace id). Right-click a trace in the dashboard:

- **Replay** — runs the receiving service in isolation against the exact recorded payload, on current code. Confirms a fix without re-driving the whole flow.
- **Promote to test** — generates an `it(...)` block in [xenosis-testing](#17-testing) format with the recorded request/response as the fixture and assertion.

Temporal nailed this for workflows; Xenosis brings the model to ordinary HTTP RPC because the trace store and the type-safe peer client already agree on the payload shape.

### v0.4 — Streaming and event sourcing transports

#### Kafka transport (`@xenosisorg/transport-kafka`)

For higher-throughput event streaming. Built on `kafkajs`. Same `PeerPublisher` / `PeerSubscriber` shape as RabbitMQ — different transport.

#### Redpanda transport (`@xenosisorg/transport-redpanda`)

Redpanda is Kafka-compatible at the wire level, so the same `kafkajs` client works. Ships as a thin alias of the Kafka transport with sensible Redpanda defaults (no topic auto-creation, single-broker friendly).

#### Redis Streams transport (`@xenosisorg/transport-redis-stream`)

Lighter-weight queue option for projects that already run Redis. Consumer groups, XADD/XREAD/XACK semantics.

### v0.5 — Real-time

#### WebSocket support (`@xenosisorg/websocket`)

First-class support for client-facing WebSocket endpoints. Not for inter-service comm (use queues for that) — for browser/mobile clients.

Planned shape:

```ts
import { definePeerApi, defineSocketApi } from '@xenosisorg/xenosis-core';

export interface ChatSocket {
  message(input: { roomId: string; text: string }): Promise<void>;
}

export const chatSocket = defineSocketApi<ChatSocket>({
  name: 'chat',
  path: '/ws/chat',
  protocol: 'json',
});
```

Server-side: `mountSocketApi(server, chatSocket, handlers)`.
Client-side: a separate `@xenosisorg/websocket-client` package for browsers.

Built on `ws` (Node) or native WebSocket (browser). Internally uses Xenosis's existing tracing and reliability layers.

### v0.6 — Observability

#### OpenTelemetry adapter (`@xenosisorg/otel`)

Drop-in OTel SDK integration. Auto-instruments:

- Express request handlers (one span per request)
- Peer calls (one span per call, parented to the request span)
- Schema package queries (one span per Prisma query, via Prisma middleware)

#### Prometheus metrics (`@xenosisorg/metrics`)

`/metrics` endpoint with default metrics: request latency, peer call latency, error rates by status, schema query latency by table.

### v1.0 — Discovery and ecosystem

#### Service discovery adapters

- `@xenosisorg/discovery-consul` — service registration and lookup via Consul
- `@xenosisorg/discovery-k8s` — Kubernetes service-account-based discovery
- `@xenosisorg/discovery-dns` — generic DNS-SD

Peer bindings can replace `baseUrl` with `discovery: { adapter: 'consul', service: 'billing' }`.

#### Testing kit (`@xenosisorg/xenosis-testing`)

The first cut ships in v0.1 (see [§17 Testing](#17-testing)): `createTestContainer({ serviceRoot })` boots a service in-process, an in-memory Postgres (PGlite) runs the real schema, peer calls are mocked, and `supertest` drives the routes. Still planned:

- In-memory engines beyond Postgres — Mongo (`mongodb-memory-server`), Redis, Dynamo
- A `xenosis create service` scaffold that emits `__tests__/setup.ts` + `vitest.config.ts`
- Transaction-rollback isolation (snapshot/reset) as an alternative to a fresh engine per test

#### Deploy templates

CLI-generated Dockerfile and Compose snippets per service, plus first-class targets:

- `xenosis deploy fly`
- `xenosis deploy railway`
- `xenosis deploy render`

#### Editor support

- VSCode snippets for service / controller / api scaffolds
- Tree-sitter highlighting for `xenosis.config.json` schema annotations
- ESLint plugin (`eslint-plugin-xenosis`) for naming convention enforcement

### Out of scope (intentionally)

- A new ORM. Use Prisma, Drizzle, MongoClient, or raw `pg.Pool`.
- A new HTTP server. Express now, Hono possibly later — but always pluggable, never bespoke.
- A new state-management story. Awilix is enough.
- A new template engine. Static frontends are not what Xenosis is for.
- Solo enterprise support contracts. Xenosis is OSS only.

---

## Further reading

- [README.md](./README.md) — project overview
- [PLAN.md](./PLAN.md) — phase-based roadmap (Phase 0–4)
- [V1_IMPLEMENTATION.md](./V1_IMPLEMENTATION.md) — detailed V1 plan
- [SCHEMAS.md](./SCHEMAS.md) — schema package reference
- [AUTOLOAD.md](./AUTOLOAD.md) — autoload reference
- [examples/README.md](./examples/README.md) — example walkthrough
