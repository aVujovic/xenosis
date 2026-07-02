# Xenosis Examples

Realistic example workspaces that exercise every piece of
`@xenosisorg/xenosis-core`: shared schema packages, internal type-safe RPC,
external API wrappers, async events, WebSockets, boundaries, the canonical
service layout, and the `xenosis` CLI.

## Layout

```
examples/
├── ts/          ← the main workspace — a 14-service e-commerce platform (TypeScript)
│   ├── apis/            ← 16 API packages: peer contracts, 4 event APIs,
│   │                       xenosis-custom/ external wrappers (httpbin)
│   ├── db-schemas/      ← @example/psql-main (Prisma over Postgres)
│   ├── shared-modules/  ← workspace-wide cradle singletons
│   ├── services/        ← users, billing, orders, cart, pricing, payments,
│   │                       notifications, analytics, playground + 5 topology stubs
│   └── infra/           ← docker-compose for Redpanda (events demo)
└── js/          ← the JavaScript variant (--lang js, JSDoc types)
    └── services/users-service-js/
```

**Start here → [`ts/README.md`](./ts/README.md)** — the full walkthrough:
which service demonstrates what, the synchronous checkout flow
(orders → cart/pricing/payments/notifications under one trace id), and the
async events pipeline (order.placed → payment + stock → confirmation →
notifications + analytics on Redpanda).

The events infrastructure (Redpanda broker + console) is described in
[`ts/infra/README.md`](./ts/infra/README.md).

## Quick start

```bash
# from the repo root — pnpm workspace already includes examples/ts/*
pnpm install

# events demo needs the broker (skip if you only hit HTTP endpoints)
docker compose -f examples/ts/infra/docker-compose.yml up -d

# run everything: 14 services + dashboard on localhost:9000
xenosis dev
```

Open http://localhost:9000 — Cards, heat-mapped peer Graph, Traces waterfall
(Time-Travel Replay + Promote-to-test), Events graph, and the Explore
click-to-call API console.

## Notes

- **Migrations are owned by the schema package.** Run the underlying ORM's
  CLI directly through pnpm — e.g.
  `pnpm --filter @example/psql-main exec prisma migrate dev`. Xenosis
  intentionally does not wrap migration commands so you keep the full feature
  set of the tool you chose (shadow databases, drift detection, seed hooks).
- Most example services use **in-memory stores** so the workspace boots
  without a database; `users-service` binds the Prisma schema package to show
  the real pattern.
