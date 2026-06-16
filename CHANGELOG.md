# Changelog

All notable changes to Xenosis packages are recorded here. Versioned together —
core, cli, testing-kit, and mcp share a release line until v1.0.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); SemVer
applies per the [pre-1.0 contract](https://semver.org/#spec-item-4) (a minor
bump in `0.x.y` may be breaking).

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
