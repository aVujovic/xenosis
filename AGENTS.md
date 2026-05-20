# Xenosis — AI agent guide

Canonical conventions for working in a **Xenosis** project. This file is the
single source of truth for any AI agent (Claude Code, Cursor, Copilot, Zed,
Codex). Tool-specific files (`CLAUDE.md`, `.claude/skills/`) point here.

Xenosis is an opinionated TypeScript microservice toolkit: awilix DI without
decorators, shared schema packages, type-safe inter-service RPC, and a
scaffolding CLI. Packages: `@xenosisorg/xenosis-core`, `@xenosisorg/xenosis-cli`.

## Golden rules

- **Never hand-wire what autoload discovers.** Add a correctly-named file in the
  right folder; the container picks it up. Don't add `container.register(...)`
  for repositories/services/controllers/jobs.
- **Type-check must pass.** `dev` runs through `tsc-watch` — a service won't
  (re)start until `tsc --noEmit` is clean. Don't leave `any`-implicit params.
- **Default export, always.** Autoloaded files register their default export.
- **Don't import from the `apis/` folder for runtime wiring** — peers come from
  config + the cradle (`this.api.<name>`). Import API packages only for types.
- Use the published package names `@xenosisorg/xenosis-core` and
  `@xenosisorg/xenosis-cli` (not `@xenosis/*`).

## Service structure

```
services/<name>-service/
  src/
    service.ts                # bootstrap (below)
    container.ts              # bare awilix container
    repository/*.repository.ts
    services/*.service.ts
    api/**/*.controller.ts
    jobs/*.job.ts
  xenosis.config.json
  package.json
```

`src/service.ts` is small:

```ts
import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';

await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.ts', lifetime: 'singleton' },
    services:     { pattern: 'src/services/*.service.ts',      lifetime: 'singleton' },
    controllers:  { pattern: 'src/api/**/*.controller.ts',     style: 'build' },
    jobs:         { pattern: 'src/jobs/*.job.ts',              lifetime: 'singleton' },
  },
});

await container.cradle.commands.start();
```

`src/container.ts` is just `export default createContainer()`.

## Autoload naming → cradle key

A file MUST be named `*.<suffix>.ts`. The suffix is the singular of the category:
`repositories`→`repository`, `services`→`service`, `controllers`→`controller`,
`jobs`→`job`, `middlewares`→`middleware`.

| File | Cradle key |
|---|---|
| `User.repository.ts` | `userRepository` |
| `UserAccount.repository.ts` | `userAccountRepository` |
| `Auth.service.ts` | `authService` |
| `Heartbeat.job.ts` | `heartbeatJob` |
| `user.controller.ts` | *(no key — `style: 'build'`)* |

- `style: 'class'` (default) → `asClass(default).<lifetime>()` under the derived key.
- `style: 'build'` (default for controllers) → `container.build(default)`, no key.
- Per-file override via `export const __xenosis = { lifetime, name, skip }`.

## Dependency injection (constructor)

Classes receive their deps as a **single destructured object** matching cradle
keys. No decorators, no manual resolution.

```ts
export default class UserService {
  private logger: ILogger;
  private userRepository: UserRepository;
  private api: { billing: BillingServiceApi };
  private whitelabel: Whitelabel;

  constructor({ logger, userRepository, api, whitelabel }: {
    logger: ILogger;
    userRepository: UserRepository;
    api: { billing: BillingServiceApi };
    whitelabel: Whitelabel;
  }) {
    this.logger = logger;
    this.userRepository = userRepository;
    this.api = api;
    this.whitelabel = whitelabel;
  }
}
```

## REST layer

Import from `@xenosisorg/xenosis-core`: `Router`, `Handler`, `Request`,
`Response`, `Exception`, and type `IServer` (plus `ExpressRequest`/`ExpressResponse`
for raw handlers).

```ts
export default function UserController({ server, userService }: {
  server: IServer; userService: UserService;
}) {
  const router = Router();

  router.route('/').get(
    Handler(Request.Query(listSchema), async (query) => {
      return Response.OK(await userService.list(query));
    }),
  );

  router.route('/').post(
    Handler(Request.Body(createSchema), async (body) => {
      return Response.Created(await userService.create(body));
    }),
  );

  server.use('/api/v1/users', router);
  return server;
}
```

- Extractors: `Request.Body(schema)`, `Request.Params(schema)`, `Request.Query(schema)`, `Request.Headers(schema)` — each adds one positional arg to the handler, left to right.
- Responses: `Response.OK`, `.Created`, `.Accepted`, `.NoContent`, `.NotFound`, `.BadRequest`.
- Errors: `throw Exception.Unauthorized(...)`, `.Forbidden(...)`, `.NotFound(...)`, `.InternalServerError(...)`.
- Schemas are zod (`z` is re-exported from core).

## Schemas (shared databases)

A schema package wraps one DB client and is imported by multiple services.

```ts
// packages/db-schemas/<name>/src/index.ts
import type { SchemaPackage } from '@xenosisorg/xenosis-core';

const pkg: SchemaPackage<PrismaClient> = {
  createClient(connector) {
    return new PrismaClient({ datasources: { db: { url: connector.url } } });
  },
  async disconnect(client) { await client.$disconnect(); },
  schema: { type: 'prisma', schemaPath: '...', migrationsPath: '...' },
};
export default pkg;
```

Bind it in the service's `xenosis.config.json`, then inject by the cradle key:

```json
{
  "connectors": { "psqlMain": { "type": "postgres", "url": "postgresql://..." } },
  "schemas":    { "mainDb": { "package": "@scope/psql-main", "connector": "psqlMain" } }
}
```

```ts
constructor({ mainDb }: { mainDb: PrismaClient }) { this.mainDb = mainDb; }
```

## Peers (inter-service RPC)

Define a service's API contract once, in its API package:

```ts
// apis/billing-api/src/index.ts
import { defineServiceApi } from '@xenosisorg/xenosis-core';

export type BillingServiceApi = {
  createCharge(input: { userId: string; amount: number; currency: string }):
    Promise<{ id: string; status: string }>;
};

export default defineServiceApi<BillingServiceApi>({
  name: 'billing',
  routes: { createCharge: { method: 'POST', path: '/api/v1/charges' } },
});
```

On the provider's controller, mark routes with a JSDoc directive so the CLI can
regenerate the contract:

```ts
/** @peer createCharge */
router.route('/').post(Handler(Request.Body(schema), async (body) => { ... }));
```

Run `xenosis sync api billing` to regenerate the `routes` block from `@peer`
directives.

Consumer declares the peer in `xenosis.config.json` and calls it via the cradle:

```json
{ "peers": { "billing": { "package": "@scope/billing-api", "transport": "http", "baseUrl": "http://localhost:4002" } } }
```

```ts
const charge = await this.api.billing.createCharge({ userId, amount, currency: 'USD' });
```

External third-party APIs live under `apis/xenosis-custom/<name>/` using
`definePeerApi` with `external: true`, `bodyEncoding`, and an `errorMapper`.

## Shared modules

Workspace-wide cradle singletons (whitelabel, feature flags). Listed in
`xenosis.workspace.json` → `sharedModules`, loaded into every service.

```ts
const module: SharedModule = {
  name: 'whitelabel',
  register(container) { container.register({ whitelabel: asClass(Whitelabel).singleton() }); },
  async init(cradle) { await cradle.whitelabel.load(); }, // optional
};
export default module;
```

Inject like any cradle key: `constructor({ whitelabel }: { whitelabel: Whitelabel })`.

## CLI commands

| Command | Notes |
|---|---|
| `xenosis create app <name>` | Bootstrap a monorepo |
| `xenosis create service <name>` | `--lang ts\|js` |
| `xenosis create api <name>` | internal peer API |
| `xenosis create api <name> --external` | external wrapper under `xenosis-custom/` |
| `xenosis create schema <name>` | `--orm prisma\|drizzle\|knex\|mongo\|dynamo`, `--db postgres\|mysql`, `--lang ts\|js` |
| `xenosis create shared-module <name>` | `--lang ts\|js`, `--style class\|function`, `--lifetime singleton\|scoped\|transient` |
| `xenosis sync api <service>` | regenerate API package from `@peer` directives |
| `xenosis generate manifest` | emit `src/.xenosis-manifest.ts` for bundled prod |
| `xenosis dev` | run all services in parallel with prefixed logs |

## Dev workflow

Each service's `dev` script:

```json
"dev": "tsc-watch --noClear --onSuccess \"node --import tsx src/service.ts --config ./xenosis.config.json\""
```

`tsc-watch` recompiles on change and only restarts the process when type-check
is clean. JS services use `node --watch --import tsx src/service.js` instead.

Run a single service from its folder with `pnpm dev`, or all of them with
`xenosis dev` from the workspace root.

## Config files

- `xenosis.config.json` (per service): `name`, `env`, `logLevel`, `port`,
  `allowedOrigins`, `connectors`, `schemas`, `peers`, `auth`.
- `xenosis.workspace.json` (root): `scope`, `defaults` (orm/port/transport),
  `structure` (apis/schemas/services/sharedModules paths), `sharedModules`.

## Common tasks — the Xenosis way

- **Add an endpoint**: edit/create a `*.controller.ts` under `src/api/`; add a
  route to the existing router. Use `Handler` + `Request.*` + `Response.*`.
- **Add business logic**: a `*.service.ts`; inject its repository by cradle key.
- **Add DB access**: a `*.repository.ts` injecting the schema cradle key (e.g. `mainDb`).
- **Call another service**: declare the peer in config, inject `api`, call
  `this.api.<name>.<method>()`; keep the contract in sync with `xenosis sync api`.
- **Don't** scaffold extra abstractions, manual DI, or barrel files — autoload +
  convention is the whole point.
