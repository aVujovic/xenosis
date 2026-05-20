# Xenosis Examples

A small, realistic monorepo that exercises every piece of `@xenosisorg/xenosis-core`:
shared schema packages, internal type-safe RPC, external API wrappers, the
canonical service layout, and the `xenosis` CLI.

## Layout

```
examples/
├── apis/                                ← shared peer API contracts
│   ├── billing-api/                     ← @example/billing-api (internal)
│   └── xenosis-custom/                    ← user-owned external wrappers
│       └── httpbin-api/                 ← @example/httpbin-api (external)
├── db-schemas/                          ← shared schema packages
│   └── psql-main/                       ← @example/psql-main (Prisma over Postgres)
└── services/
    ├── users-service/                   ← port 4001, canonical layout + internal peer
    ├── billing-service/                 ← port 4002, peer provider
    └── playground-service/              ← port 4010, external peer demo (httpbin.org)
```

## What each piece demonstrates

### Services

| Service | Port | Demonstrates |
|---|---|---|
| **users-service** | 4001 | Canonical layout (autoload + Prisma schema + healthcheck + zod validation). Calls `billing-service` over an internal type-safe peer. |
| **billing-service** | 4002 | Peer **provider** side: implements `BillingApi` via `mountPeerApi`. In-memory charge store for the demo. |
| **playground-service** | 4010 | External peer integration end-to-end: form-urlencoded body encoding, custom `Authorization` header, vendor `errorMapper`. |

### Schema packages

| Package | Backend | Used by |
|---|---|---|
| `@example/psql-main` | Prisma + Postgres | users-service (`mainDb`), billing-service is in-memory so does not bind |

### API packages

| Package | Type | Provider | Consumer |
|---|---|---|---|
| `@example/billing-api` | Internal Xenosis peer | billing-service | users-service |
| `@example/httpbin-api` | External (under `xenosis-custom/`) | httpbin.org (3rd party) | playground-service |

## Canonical service layout (users-service)

`users-service` is the reference everyone should copy:

```
users-service/
├── xenosis.config.json            ← runtime config (connectors + schemas + peers)
├── config.example.json
├── package.json
├── tsconfig.json
└── src/
    ├── service.ts               ← 6-line bootstrap
    ├── container.ts             ← createContainer()
    ├── api/
    │   ├── healthcheck/healthcheck.controller.ts
    │   └── user/
    │       ├── user.controller.ts
    │       └── user.schema.ts
    ├── services/User.service.ts
    └── repository/User.repository.ts
```

Bootstrap is autoload-driven — no manual `container.register({...})` calls:

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

A new file `Order.service.ts` in `src/services/` automatically appears as `cradle.orderService` on the next restart. See [AUTOLOAD.md](../AUTOLOAD.md) for the full convention.

## Running the examples

### 1. Infrastructure

```bash
docker run -d --name xenosis-pg    -e POSTGRES_USER=xenosis -e POSTGRES_PASSWORD=xenosis_dev -p 5432:5432 postgres:16-alpine
docker run -d --name xenosis-redis -p 6379:6379 redis:7-alpine
```

### 2. Database + migrations

```bash
PGPASSWORD=xenosis_dev psql -h localhost -U xenosis -d postgres -c 'CREATE DATABASE xenosis_main;'

DATABASE_URL='postgresql://xenosis:xenosis_dev@localhost:5432/xenosis_main' \
  pnpm --filter @example/psql-main exec prisma migrate deploy
```

### 3. Run all three services in parallel

```bash
xenosis dev
```

The CLI discovers every service in `examples/ts/services/` and runs them in
parallel with color-prefixed logs:

```
→ Starting 3 services…
  • billing-service
  • playground-service
  • users-service

[billing-service]   🚀 Service is running on http://127.0.0.1:4002
[playground-service] 🚀 Service is running on http://127.0.0.1:4010
[users-service]     🚀 Service is running on http://127.0.0.1:4001
```

### 4. Try the flows

**Create a user and trigger an internal peer call** (`users-service` → `billing-service`):

```bash
USER_RESP=$(curl -s -X POST http://localhost:4001/api/v1/users \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice"}')

USER_ID=$(echo "$USER_RESP" | jq -r .id)

curl -X POST "http://localhost:4001/api/v1/users/$USER_ID/upgrade" \
  -H 'content-type: application/json' \
  -d '{"amount":4200,"currency":"USD"}'
# → { "user": {...}, "charge": { "id": "...", "status": "completed", ... } }
```

**Exercise the external peer** (form encoding + Bearer auth + errorMapper):

```bash
curl -X POST http://localhost:4010/api/v1/httpbin/echo \
  -H 'content-type: application/json' \
  -d '{"amount":4200,"currency":"USD","note":"hello"}'
# → httpbin echo showing form-urlencoded body + custom Authorization header

curl http://localhost:4010/api/v1/httpbin/status/418
# → 418 { "name": "ImATeapot", ... } via the httpbinApi.errorMapper
```

## What this proves

1. **Two services on a shared database with identical types.**
   Both `users-service` and the implementation that backs the `BillingApi`
   provider (in this example, in-memory; in production it would be its own
   `mysql-billing` schema package) import their schema as an npm dependency.
   Same package → same types everywhere.

2. **Type-safe RPC with no codegen.**
   `users-service` imports `BillingApi` from `@example/billing-api` and gets
   full TS inference on `this.billing.createCharge({...})`. The provider
   imports the same package and `mountPeerApi` wires the routes.

3. **External APIs through the same contract shape.**
   `httpbin-api` lives under `apis/xenosis-custom/` with `external: true`,
   `bodyEncoding: 'form-urlencoded'`, and an `errorMapper`. The consumer code
   is identical to the internal-peer pattern.

## Open work

- **Graceful shutdown.** `schemaDisconnects` collected but `commands.start()` does not yet drain on SIGTERM.
- **Migrations are owned by the schema package.** Run the underlying ORM's CLI directly through pnpm — e.g. `pnpm --filter @example/psql-main exec prisma migrate dev`. Xenosis intentionally does not wrap migration commands so you keep the full feature set of the tool you chose (shadow databases, drift detection, seed hooks, custom resolvers).
