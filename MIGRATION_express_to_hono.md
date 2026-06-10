# Migrating a Xenosis service from Express to Hono

Xenosis ships two HTTP adapters behind the same `XServer` contract:

- **Express** (default) — `express` + `cors` + `express.json/urlencoded/text`
- **Hono** (opt-in) — `hono` + `@hono/node-server` + `hono/cors`

The switch is a single config flag plus two package installs. User code
(controllers, middleware, schemas, peer handlers) is identical under both
runtimes — the framework is hidden behind the `XReq`/`XRes`/`XHandler`/`XRouter`
abstractions exported from `@xenosisorg/xenosis-core`.

## Steps

### 1. Install Hono in your service

```bash
pnpm add hono @hono/node-server
```

These are declared as **optional peer dependencies** of `@xenosisorg/xenosis-core`,
so services that stay on Express never resolve them.

### 2. Flip `http.framework` in `xenosis.config.json`

```jsonc
{
  "name": "my-service",
  "port": 4000,
  "http": {
    "framework": "hono"
  }
}
```

That's it. Restart the service and the same routes serve identical responses.

### 3. Verify

```bash
# Same controller code, same response on either adapter.
curl http://localhost:4000/healthcheck/
curl http://localhost:4000/openapi.json | jq '.paths | keys'
```

The OpenAPI document, the Swagger UI at `/docs`, and the peer-RPC endpoints
work the same way on either adapter.

## What stays the same

Everything in your `src/` tree:

- Controllers — `Handler(Request.Body(s), async (body) => Response.OK(...))`
- Routers — `Router()` from `@xenosisorg/xenosis-core` (recording router that
  both adapters re-register against their native verb methods)
- Middleware — typed as `XHandler` (`(req: XReq, res: XRes, next: XNext) => …`)
- Shared modules / resolvers — `(req: XReq) => Promise<T>`
- Peer APIs — `definePeerApi` / `mountPeerApi`
- Sockets — `defineSocketApi` + `loadSockets` (both adapters expose the
  underlying `node:http.Server` via the `HTTP_SERVER` symbol so the WS
  transport attaches the same way)
- Request-scoped trace context — `req.scope`, `req.traceContext`,
  `req.requestLogger`, `req.isReplay` are fields on `XReq.XRequestContext`
- OpenAPI registry + `/docs` — adapter-neutral; the recording `Router()`
  feeds both
- `errorHandlerMiddleware` — mounted via `adapter.mountErrorHandler` so the
  Express 4-arg convention and Hono's `onError` both end up at the same
  handler

## What changes under the hood

These are implementation details, not surface — listed for the curious.

| Concern | Express adapter | Hono adapter |
|---|---|---|
| HTTP framework | `express()` | `new Hono()` |
| CORS | `cors()` middleware | `hono/cors` middleware |
| Body parsing | `express.json/urlencoded/text` | `c.req.json/parseBody/text` (eager pre-parse) |
| Routing | `app[verb](path, …handlers)` | `hono[verb](path, …handlers)`, both `/x` and `/x/` aliased |
| Request shape | Express `Request` (already `XReq`-shaped) | Web `Request` adapted to `XReq` via glue layer |
| Response shape | Express `Response` (mutable, `.status().send()`) | `XRes` builder collects status + headers + body, then emits a Web `Response` |
| Error handler | `app.use((err, req, res, next) => …)` | `app.onError((err, c) => …)` calling the same `XErrorHandler` |
| `node:http.Server` | `createServer(app)` | `createServer(getRequestListener(hono.fetch))` |
| Listen | `httpServer.listen(port)` | `httpServer.listen(port)` |
| Sockets `upgrade` | Same `HTTP_SERVER` symbol | Same `HTTP_SERVER` symbol |

## Caveats

- **Raw `(req, res, next)` Express middleware** (e.g. a hand-rolled
  `(req, res) => res.status(200).send(...)` directly on a router instead of
  going through `Handler(...)`) still works on Hono because `XReq`/`XRes`
  intentionally mirror the Express subset most code uses. If you reach into
  Express-specific helpers (`res.type()`, `res.cookie()`, `res.format()`,
  `req.accepts()`, `req.get()`), refactor to:
  - `res.setHeader('content-type', '…')` instead of `res.type(…)`
  - `req.header('…')` instead of `req.get('…')`
  - cookies / content negotiation — keep on Express for now, or wrap via
    a small shared utility that branches on `req.raw`
- **`req.raw` is framework-specific** — Express adapter sets it to the
  Express `Request`; Hono adapter sets it to the Hono `Context`. Code that
  reads `req.raw` is by definition adapter-aware; if you need that escape
  hatch, branch on `config.http?.framework` or accept that you've left the
  portable surface.
- **Streaming responses** are not yet wired through the abstraction. Both
  adapters can do streaming natively (`res.write()` on Express,
  `c.body(stream)` on Hono), but the unified `Response.apply()` path
  buffers a single body. If you need streaming, drop down to `res.raw`
  on the adapter you've chosen.
- **`router.use(...)`** is a no-op on the recording `Router()` because the
  adapter re-registers each verb separately and there's no meaningful
  translation of sub-router middleware to Hono. Attach middleware at the
  verb level: `router.get('/x', authMw, Handler(...))`.

## Going back to Express

Just remove the flag (or set it to `"express"`):

```jsonc
{
  "http": {
    "framework": "express"
  }
}
```

You can leave `hono` and `@hono/node-server` installed; they aren't
imported unless `framework === "hono"`.
