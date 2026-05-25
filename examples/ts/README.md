# Xenosis — Example Workspace (TypeScript)

A full e-commerce workspace built with [Xenosis](https://xenosis.org): **13
services**, 12 internal API packages, an external API wrapper, a Prisma schema
package, and three shared modules. It's the worked example behind the tutorial
[*From Zero to 3 Production-Ready Microservices in Minutes*](https://xenosis.org/blog/production-ready-microservices-in-minutes).

Everything here was scaffolded with the `xenosis` CLI and runs end-to-end.

## Run it

```bash
pnpm install
xenosis dev          # all services in parallel, prefixed logs
xenosis graph        # who-calls-who + boundary lint
```

Trigger the checkout chain:

```bash
curl -XPOST localhost:4018/api/v1/orders \
  -H 'content-type: application/json' \
  -d '{"userId":"user-42"}'
```

## The checkout flow (real, end-to-end)

`orders-service` orchestrates a checkout across four peers over the typed
`this.api.*` proxy — one trace ID threads the whole chain:

```
orders.createOrder(userId)
  → cart.getCart(userId)            # line items
  → pricing.quote(lines)            # subtotal + tax + total
  → payments.charge(orderId, …)     # capture — then calls back:
      → orders.markPaid(orderId)    # reverse leg (payments → orders)
  → notifications.orderConfirmed(…) # tell the user
```

`payments` is locked with `boundaries.allowedCallers: ["orders"]` — only orders
may charge it. Run `xenosis graph` to see the topology and lint violations.

## Where the tutorial steps live

| Tutorial step | In this repo |
|---|---|
| Bootstrap (`create app`) | `xenosis.workspace.json`, root `Dockerfile` (at repo root) |
| Services (`create service`) | [`services/`](./services) — 13 services |
| Contracts (`create api` + `defineServiceApi`) | [`apis/`](./apis) — e.g. [`apis/orders-api`](./apis/orders-api/src/index.ts) |
| Peer calls (`this.api.<name>.*`) | [`services/orders-service/src/services/Order.service.ts`](./services/orders-service/src/services/Order.service.ts) |
| Boundaries (`allowedCallers`) | [`services/payments-service/xenosis.config.json`](./services/payments-service/xenosis.config.json) |
| Built-in auth gate | any service's `xenosis.config.json` → `authentication` |
| Config schema (typed + validated) | each service's `src/config.schema.ts` |
| Tests (in-process, peer mocks) | [`services/billing-service/__tests__/`](./services/billing-service/__tests__) |
| Shared modules | [`shared-modules/`](./shared-modules) — whitelabel, resolve-user, resolve-tenant |
| Schema package (Prisma) | [`db-schemas/psql-main`](./db-schemas/psql-main) |
| External API wrapper | [`apis/xenosis-custom`](./apis/xenosis-custom) — httpbin |

## Services

| Service | Port | Calls | Role |
|---|---|---|---|
| `users-service` | 4001 | billing | Canonical layout — autoload, Prisma schema, JWT auth |
| `billing-service` | 4002 | users | Charges; has a `__tests__` suite |
| `orders-service` | 4018 | cart, pricing, payments, notifications | Checkout orchestrator |
| `cart-service` | 4017 | — | Line items |
| `pricing-service` | 4016 | — | Quote (subtotal + tax) |
| `payments-service` | 4013 | orders | Charge + `markPaid` callback — `allowedCallers: [orders]` |
| `notifications-service` | 4022 | — | Order confirmation |
| `playground-service` | 4010 | httpbin | External peer (form-urlencoded, errorMapper) |
| `catalog` / `inventory` / `shipping` / `reviews` / `search` | 4014–4021 | various | Stubs that make `xenosis graph` + boundaries meaningful |

The eight services above the stubs are implemented for real (in-memory stores);
the five stubs return a placeholder greeting so the peer graph is realistic.

## Deploy

A Xenosis service runs from source with `tsx` — no build step:

```bash
NODE_ENV=production pnpm --filter orders-service start
```

Or containerise any service with the root `Dockerfile`:

```bash
docker build --build-arg SERVICE=orders-service --build-arg PORT=4018 -t orders .
docker run -p 4018:4018 orders
```

See the [full tutorial](https://xenosis.org/blog/production-ready-microservices-in-minutes)
and the [docs](https://xenosis.org/docs).
