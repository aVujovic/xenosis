# Changelog

All notable changes to Xenosis packages are recorded here. Versioned together —
core, cli, testing-kit, and mcp share a release line until v1.0.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); SemVer
applies per the [pre-1.0 contract](https://semver.org/#spec-item-4) (a minor
bump in `0.x.y` may be breaking).

## [cli 0.2.3 · testing 0.1.1] — 2026-07-29

Template repairs — every trap here shipped inside the CLI since the 0.1.0
HTTP-layer migration, so a freshly scaffolded workspace carried them all.

### Fixed — `@xenosisorg/xenosis-cli`

- **Service template didn't compile against the core it pins.** The
  healthcheck controller imported `ExpressRequest` / `ExpressResponse`,
  removed from core in 0.1.0. Now uses `XReq` / `XRes`.
- **Stale dependency pins in every template.** `@xenosisorg/xenosis-core`
  was pinned `^0.1.0` in 17 template package.json files — a caret on `0.x`
  never crosses the minor, so scaffolds resolved core 0.1.x while the
  templates target 0.2.x. Now `^0.2.2`; template CLI pins bumped to
  `^0.2.3`, testing pins to `^0.1.1`.
- **Schema templates hid `createTestClient` from the testing kit.** The
  generated `export const { createClient, schema, disconnect } = pkg` made
  the module namespace win during package resolution, so a user-added
  `createTestClient` on the default export was never seen and every
  database-backed test failed. All 7 schema templates (and the psql-main
  example) now include `createTestClient` in the destructured export list.
- **`schema-prisma-postgres` (TS + JS) now ships a working
  `createTestClient`** — PGlite via `pglite-prisma-adapter` (optional peer
  deps), mirroring the psql-main example. Scaffolded Prisma/Postgres schemas
  are testable out of the box.

### Fixed — `@xenosisorg/xenosis-testing`

- **Package resolution now prefers the default export.** Previously a module
  namespace with a named `createClient` beat the default export, making
  `createTestClient` invisible even when the package defined it. Existing
  scaffolded projects get working database tests without any code change.
- **Schema packages resolve from the service's node_modules.** The kit used a
  bare `import(binding.package)`, which resolves relative to the kit's own
  install location — invisible to the service's dependencies under pnpm's
  isolated layout. Now mirrors core's `importFromService` walk-up, rooted at
  `serviceRoot`.

### Docs

- New **§ 21b Known constraints & gotchas** in `DOCUMENTATION.md`:
  `.use()`-only routers, awilix strict cradle, relative value imports in
  autoloaded files under the test harness, Prisma `P2010` / `meta.code`.

## [core 0.2.2 · cli 0.2.2] — 2026-07-02

Documentation refresh + dashboard Explore tab. No runtime changes in core.

### Changed — `@xenosisorg/xenosis-core`

- **Docs-only release.** README brought in line with 0.2.x reality: status
  header, roadmap tables (events shipped as the atomic contract; RabbitMQ
  removed from "in progress"), repository layout, and dead links to deleted
  planning files replaced with xenosis.org links. Same cleanup in
  `DOCUMENTATION.md` (§20 dashboard now describes all five views, §22 roadmap
  rewritten, MCP tool table lists all seven tools).

### Added — `@xenosisorg/xenosis-cli`

- **Dashboard Explore tab** — click-to-call API console: aggregated endpoint
  list across all running services (`GET /api/openapi-index`), forms
  auto-generated from each endpoint's OpenAPI request schema, calls proxied
  through the dashboard (`POST /api/explore/call`) so the browser avoids
  per-service CORS, response viewer with status + duration, last-20-calls
  history.
- **Header refresh** — xenosis.org-style brand + link-style tab navigation.

## [core 0.2.1 · cli 0.2.1 · mcp 0.2.1] — 2026-07-02

Two bug fixes found while live-verifying the events pipeline demo.

### Fixed — `@xenosisorg/xenosis-core`

- **Trace propagation across event handlers.** Previously, when a consumer
  handler called `events.<binding>.<topic>.publish(...)` to fan out
  downstream, the outbound message's trace headers were read from the
  **root container's cradle** instead of the **per-message handler scope**.
  Result: the inbound message's `traceId` was silently dropped and a fresh
  trace was minted for every downstream publish — a single fan-out
  appeared as several disconnected traces in the dashboard.

  Fix: introduced a `TraceProvider` abstraction with two implementations —
  `makeRootTraceProvider` (default, reads root cradle for background
  publishes) and `makeScopeTraceProvider` (used inside the consumer
  dispatch loop, reads the handler's per-message scope). Each consumer
  handler now gets a scope-local `events` cradle entry whose publish
  functions carry the inbound message's trace forward.

  End-to-end: an HTTP request → order.placed → payment.captured →
  order.confirmed → notifications chain now shares one traceId across
  all five services, matching how the HTTP layer + sockets have always
  worked.

### Fixed — `@xenosisorg/xenosis-cli` + `@xenosisorg/xenosis-mcp`

- **`xenosis events verify` no longer false-positives on `.publish()`
  calls inside comments.** The static scanner used a plain regex against
  the source file, which matched `events.orders.orderShipped.publish(...)`
  in a JSDoc block as if it were a real call site. Fix: strip `/* ... */`
  and `// ...` comments (skipping URL-scheme colons) before scanning.
  Same fix applied to the MCP copy of `event-graph-core.ts`.

### Notes

- Purely a bug-fix release — no API changes, no config changes, no
  migration. `0.2.0 → 0.2.1` is a drop-in upgrade.
- `testing-kit` stays on `0.1.0`.

---

## [core 0.2.0 · cli 0.2.0 · mcp 0.2.0] — 2026-07-01

**Async communication is now a first-class atomic contract.** Every event
binding must declare exactly which topics it publishes and which it consumes;
the framework enforces the contract at every stage (TypeScript, boot, CI) so
a service cannot silently drift out of alignment with its declared role.

This is a **breaking change** — existing services with events bindings must
either declare the new fields or run `xenosis events verify --fix` once to
autopopulate them from the actual code.

### Breaking — `@xenosisorg/xenosis-core`

- **`events.<binding>.publishes` is now required** whenever `mode` includes
  `"producer"` (or `"both"`). Each entry must be a topic key declared in the
  api package's `defineEventApi({ topics })`. The producer bus (`events.<binding>`)
  only exposes the topics in this list; calling `.publish()` on a topic
  outside the list is a runtime error (property is `undefined`) and a
  TypeScript error when using the new `ProducerBus<TApi, K>` type.
- **`events.<binding>.consumes` is now required** whenever `mode` includes
  `"consumer"` (or `"both"`). Each entry must be a topic key declared in the
  api package. The events loader verifies at boot that the set of
  `src/events/*.event.ts` handlers matches `consumes` exactly — extra
  handlers or missing handlers both abort startup with a precise error.
- The producer bus is now narrowed to the `publishes` whitelist at both the
  runtime (property doesn't exist outside the list) and type (via
  `ProducerBus<TApi, K>`) layers. The old `EventBus<TApi>` remains exported
  for backwards-compatibility in downstream types but is no longer what the
  cradle actually holds when `publishes` is set.

### Added — `@xenosisorg/xenosis-core`

- **`ProducerBus<TApi, K extends keyof TApi['topics']>`** — narrow producer
  bus type. Use in service constructor deps so TS blocks `.publish()` calls
  on topics not in the binding's `publishes` list.
- **`ConsumerBus<TApi, K extends keyof TApi['topics']>`** — narrow consumer
  bus type. Exposes `topic` + `schema` for allowed keys but no `publish()`.
- Boot-time atomic contract check with actionable error messages: missing
  `publishes` / `consumes`, unknown topic keys (typos), handler-vs-consumes
  mismatch, orphan handlers, mode-vs-list contradictions all abort startup
  with a clear "here's what's wrong and here's how to fix" message.

### Added — `@xenosisorg/xenosis-cli`

- **`xenosis events verify`** — atomic-contract checker that runs
  statically (no service boot required). Reports every drift as an error
  with the offending config path, exit code 1 on any error.
- **`xenosis events verify --fix`** — autopopulates `publishes` and
  `consumes` from `.publish()` call sites in `src/**` and from
  `defineEventHandler(...)` in `src/events/*.event.ts`. One-shot migration
  path for existing services.
- **`xenosis events verify --workspace`** — additional pass that flags
  orphan topics (published but no consumer in the workspace) and unserved
  consumers (handler exists but no producer emits the topic). Runs
  cross-service dependency analysis suitable for CI.
- New static scanner in `event-graph-core.ts` — `scanPublishCalls()` finds
  `events.<binding>.<topic>.publish(` and common alias patterns; used by
  both the verify command and `xenosis graph --events`.

### Added — `@xenosisorg/xenosis-mcp`

- Internal `event-graph-core.ts` copy synced with the CLI's extended graph
  primitives (adds `publishes`/`consumes` fields to `EventBinding`,
  `configPath` and `publishesByBinding` to `EventServiceNode`).
- `get_event_graph` MCP tool automatically returns the new fields — AI
  assistants now see explicit publish/consume declarations, not just modes.

### Migration

For each service with events bindings:

```bash
xenosis events verify --fix       # one-shot autopopulate
xenosis events verify             # confirm clean
xenosis events verify --workspace # optional: check cross-service orphans
```

Add to CI (e.g. `.github/workflows/*.yml`):

```yaml
- run: pnpm exec xenosis events verify --workspace
```

Producer-side callers can also opt into the new narrow type for compile-time
safety:

```ts
import type { ProducerBus } from '@xenosisorg/xenosis-core';
import type ordersEvents from '@example/orders-events';

constructor(private deps: {
  events: {
    orders: ProducerBus<typeof ordersEvents, 'orderPlaced' | 'orderConfirmed'>;
  };
}) {}
```

### Notes

- `testing-kit` stays on `0.1.0` — atomic contract is enforced at boot and
  through the CLI, no test-kit surface changes.
- Older configs without `publishes`/`consumes` will FAIL boot on 0.2.0 —
  this is the intended safety net. Run `--fix` before deploying.

---

## [core 0.1.2 · cli 0.1.1 · mcp 0.1.1] — 2026-06-16

Events landed: a transport-agnostic async pub/sub layer between services,
behind the same `defineEventApi` contract running on Kafka, Redpanda, NATS
(JetStream), Redis Streams, or an in-memory bus for tests. Same producer
code, same consumer handler, the transport is a config flag.

### Added — `@xenosisorg/xenosis-core`

- **`defineEventApi(...)`** — declare a typed async event contract in a
  shared npm package (same idiom as `definePeerApi` / `defineSocketApi`).
  Topics carry a wire name, a zod payload schema, and an optional zod key
  schema for partitioned/keyed delivery.
- **`defineEventHandler(topicSpec, fn)`** — bind a consumer handler to a
  topic from an event API package. The default export of
  `src/events/<Name>.event.ts` is autoloaded at boot — no manual wiring.
- **`EventBus<TApi>`** cradle entry under `events.<bindingName>`, fully
  typed: `this.deps.events.billing.chargeSucceeded.publish(key, payload)`.
- **`EventContext`** handed to every consumer handler: per-message awilix
  scope, reconstructed trace context (`x-xenosis-trace-*` headers
  propagate end-to-end), child logger bound to `{traceId, topic, messageId}`,
  decoded key + offset + timestamp.
- **Five built-in transports** behind the same `EventTransportProvider`
  interface:
  - `kafka` — kafkajs, producer + consumer groups, auto-commit, header
    propagation.
  - `redpanda` — wire-compatible reuse of the Kafka adapter.
  - `nats` — JetStream by default for durable streams, falls back to Core
    pub on stream-binding errors, explicit ack/nak. Requires the optional
    `nats` peer dep (~13 kB on disk; not pulled when unused).
  - `redis-streams` — XADD / XREADGROUP, automatic XGROUP CREATE, pending
    entries list survives crashes.
  - `memory` — process-wide singleton bus; ideal for unit tests + `xenosis
    dev` without external infra.
- **Third-party transports** plug in via dynamic import: set
  `transport: '@scope/event-transport-x'` and Xenosis resolves the package's
  default export as an `EventTransportProvider`.
- **Schema validation on both sides** — `publish()` zod-checks the key +
  payload before sending; the loader zod-checks consumed messages before
  invoking the handler. `validation: 'off'` opts out for migrations.
- **Graceful shutdown** — each transport's producer + consumer registers a
  `disconnect()` callback in the central `Signals` stack. SIGTERM drains
  consumers first (no new messages), then flushes producers, then closes
  transports — same ordering as the other layers.
- New `config.events.<binding>` schema block with `package`, `transport`,
  `connector` (cradle key of a connector whose config to reuse), `mode`
  (`producer | consumer | both`), `groupId`, `fromBeginning`, `validation`.
- New exports: `defineEventApi`, `defineEventHandler`, `loadEvents`, and
  types `EventApi`, `EventTopicSpec`, `EventTopicMap`, `EventBus`,
  `EventContext`, `EventHandlerFn`, `BoundEventHandler`, `PublishOptions`,
  `EventTransportProvider`, `EventTransportProducer`,
  `EventTransportConsumer`, `PublishMessage`, `ConsumeMessage`,
  `SubscribeOptions`.

### Added — `@xenosisorg/xenosis-cli`

- **`xenosis create event-api <name>`** — scaffolds an event contract
  package under `apis/<name>-events/` (zod schemas, idiomatic README, build
  script, workspace-pinned core dep). Same flow as `create api` and
  `create socket-api`.
- **`xenosis graph --events`** — async-mesh view. `--tree` for ASCII
  producer/consumer tree per api/topic; `--json` for CI / dashboard / MCP
  consumption. Flags orphan topics (published but no consumer in the
  workspace) and unserved consumers (handler exists but no producer in the
  workspace emits the topic).
- **Dev dashboard "Events" tab** (`xenosis dev`) — live render of the
  event mesh against the running workspace; surfaces the same orphans /
  unserved-consumers warnings the CLI does; clickable api / topic /
  service identities.
- New endpoint `GET /api/events-graph` on the dashboard server.
- Template `templates/event-api/` (package.json, src/index.ts, README.md).
- Help text + dispatcher entries for the new subcommands.

### Added — `@xenosisorg/xenosis-mcp`

- **`get_event_graph` MCP tool** — returns the same EventGraph shape as
  `xenosis graph --events --json`, so AI assistants can answer questions
  like "who publishes order.created?" or "what handlers react to
  charge.refunded?" without scanning the codebase by hand. Surfaces orphans
  and unserved consumers in the response so the agent can flag dead topics
  proactively.
- Tool count bumped to **7** (was 6).
- Internal `event-graph-core.ts` copy of the CLI's primitives — same
  convention as `graph-core.ts`: parallel sources, kept in sync by hand,
  no cross-package runtime dep.

### Notes

- `testing-kit` stays on `0.1.0` — events have no test-kit story yet (the
  in-memory transport already serves that role in unit tests).
- Older configs without an `events` block continue to work unchanged.
- Optional peer dep `nats` ^2.28.0 added to core's `package.json`.

---

## [core 0.1.1] — 2026-06-16

Additive — older config files continue to work unchanged.

### Added

- **`@xenosisorg/xenosis-core`** — `$env:` placeholder support in
  `xenosis.config.json`. Any string value may reference an environment
  variable, expanded before zod validation so the schema validates the final,
  env-resolved shape. Three forms:
  - `"$env:NAME"` — basic; missing → leaves the key undefined so zod reports
    the precise path.
  - `"$env:NAME:-default"` — fallback default when the env is unset/empty.
  - `"$env:NAME:?required"` — throws at config load with the offending path
    and env name in the message.
  Whole-value placeholders coerce numeric strings to `number`, `"true"`/
  `"false"` to `boolean`, and `"null"` to `null` so a single string env
  satisfies typed schema fields (e.g. `"port": "$env:PORT"` against `z.number()`).
  Placeholders inside larger strings are substituted inline without coercion
  (e.g. `"postgresql://app:$env:PG_PASS@db:5432/users"`).
- Works for userland config keys declared via `defineConfigSchema` with zero
  extra wiring — the expansion runs before any schema sees the value.

### Notes

- `cli`, `testing-kit`, and `mcp` stay on `0.1.0`. Only core gained the env
  expansion; sibling packages need no rebuild.
- Xenosis still reads from `process.env` only — `.env` files are not loaded
  automatically. Add `import 'dotenv/config'` at the top of `src/service.ts`
  if you want that.

---

## [0.1.0] — 2026-06-09

The framework-agnostic HTTP layer ships. Same controllers, Express by default,
**Hono** opt-in via one config flag.

### Breaking

- **`@xenosisorg/xenosis-core`** — removed the Express type re-exports from the
  public API: `ExpressRequest`, `ExpressResponse`, `NextFunction`, and
  `RequestHandler` are no longer exported. Replace with the framework-agnostic
  types: `XReq`, `XRes`, `XNext`, `XHandler`. `IServer` now resolves to the
  abstract `XServer` rather than Express's `Application`.
- **`@xenosisorg/xenosis-core`** — the `declare global namespace Express`
  augmentation that added `req.scope` / `req.traceContext` / `req.requestLogger`
  / `req.isReplay` is gone. Those fields are now declared on `XReq` via
  `XRequestContext` and available on either adapter without globally widening
  Express's namespace.
- **`@xenosisorg/xenosis-core`** — the deprecated `asyncHandler` export is
  removed. Use `Handler(...)` from the REST layer instead.
- **`@xenosisorg/xenosis-core`** — the recording `Router()` is now a pure
  framework-agnostic registry. `router.use(...)` is a no-op (each verb is
  re-registered by the adapter); attach middleware at the verb level:
  `router.get('/x', authMw, Handler(...))`.

### Added

- **`@xenosisorg/xenosis-core`** — `HttpAdapter` abstraction with two
  implementations behind the same contract:
  - `createExpressAdapter` (default) — `express` + `cors` + `express.json/
    urlencoded/text`.
  - `createHonoAdapter` (opt-in) — `hono` + `@hono/node-server` + `hono/cors`,
    `Context⇄XReq/XRes` glue, eager body pre-parse, error-handler bridge,
    `/x` and `/x/` aliasing for Express parity.
- **`@xenosisorg/xenosis-core`** — framework-agnostic types in `src/rest/http`:
  `XReq`, `XRes`, `XNext`, `XHandler`, `XErrorHandler`, `XRouter`, `XServer`,
  `XRequestContext`. User code (controllers, middleware, peers, sockets, OpenAPI
  loader) operates on these types — Express is no longer leaked through the
  public surface.
- **`@xenosisorg/xenosis-core`** — `http.framework: 'express' | 'hono'` config
  key (defaults to `'express'`).
- **`@xenosisorg/xenosis-core`** — `hono` and `@hono/node-server` declared as
  **optional peer dependencies**. Services on Express never resolve them.
- **`@xenosisorg/xenosis-cli`** — `xenosis migrate http --to <express|hono>`
  command. Patches `xenosis.config.json` + `package.json` deps and scans `src/`
  for Express-only API calls (`res.type`, `res.cookie`, `req.get`,
  `req.accepts`, `from 'express'`, …) with `file:line` hints.

### Changed

- **`@xenosisorg/xenosis-core`** — `xenosisBootstrap` is now `await`-based on
  the adapter (Hono is loaded via dynamic import). The bootstrap registers
  `httpAdapter` (internal) and the framework-agnostic `server` cradle key.
- **`@xenosisorg/xenosis-core`** — `commands.start()` mounts the error handler
  through `adapter.mountErrorHandler` and listens through `adapter.listen` —
  the EADDRINUSE retry semantics are preserved on both adapters.
- **`@xenosisorg/xenosis-core`** — `OPENAPI_REGISTRY` is now adapter-owned;
  the OpenAPI loader and Swagger UI work identically on either adapter.
- **`@xenosisorg/xenosis-core`** — `node:http.Server` is exposed by both
  adapters via the same `HTTP_SERVER` symbol, so the sockets loader attaches
  the WS `upgrade` handler the same way regardless of framework.
- **`@xenosisorg/xenosis-testing`** — peer dependency on
  `@xenosisorg/xenosis-core` bumped to `>=0.1.0`. The testing kit's `ctx.server`
  is still passed to `supertest` (Express-flavoured); migrating the test kit
  to a framework-agnostic client is tracked for a follow-up release.

### Migration

Run `xenosis migrate http --to hono` inside a service directory to flip the
adapter and patch deps in one step. The full migration guide is in
[`MIGRATION_express_to_hono.md`](MIGRATION_express_to_hono.md) and on the docs
site at [xenosis.org/docs/http-frameworks](https://xenosis.org/docs/http-frameworks/).

For an existing service that compiles against `0.0.12` of core, the only
likely source-code touchups are:

- Replace `import type { Request, Response, NextFunction } from 'express'` in
  middleware factories with `import type { XReq, XRes, XNext, XHandler } from
  '@xenosisorg/xenosis-core'`.
- Drop `import type { RequestHandler } from '@xenosisorg/xenosis-core'`; use
  `XHandler` instead.
- If you typed `authMiddleware: RequestHandler` in a controller's
  destructured deps, change it to `authMiddleware: XHandler`.

User-written controllers using `Handler(Request.Body(...), async (body) =>
Response.OK(...))` need no changes.

### Legacy

The `0.0.x` line is preserved on the `legacy/v0.0.x` branch. Critical fixes
to `0.0.12` will be cut from there as `0.0.13+` and published with the npm
`legacy` dist-tag.

---

## [0.0.12] — 2026-06-08

Final `0.0.x` release. See [`legacy/v0.0.x`](https://github.com/aVujovic/xenosis/tree/legacy/v0.0.x)
branch for older history.
