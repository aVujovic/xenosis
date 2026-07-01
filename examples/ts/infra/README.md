# Events demo — infra

Local **Redpanda** broker + **Redpanda Console** UI, wired for the Xenosis
events demo services (`orders-service`, `payments-service`,
`inventory-service`, `notifications-service`, `analytics-service`).

## Ports

| Endpoint | Address | Used by |
|---|---|---|
| Kafka API | `localhost:29092` | every service's `connectors.kafka.brokers` |
| Console UI | http://localhost:8086 | you, in a browser |
| Admin API | `localhost:29644` | `rpk` if you install it |
| Schema Registry | `localhost:28081` | not used in the demo |

## Bring it up

```bash
docker compose -f examples/ts/infra/docker-compose.yml up -d
```

Wait ~5 seconds for the healthcheck to go green (`docker ps` should show
`(healthy)` next to the container). Then:

```bash
# In separate terminals, or as a single xenosis dev session:
pnpm --filter orders-service        dev
pnpm --filter payments-service      dev
pnpm --filter inventory-service     dev
pnpm --filter notifications-service dev
pnpm --filter analytics-service     dev

# OR — run everything + the dashboard at http://localhost:9000:
cd examples/ts && xenosis dev
```

## Trigger the pipeline

Publish `orders.order.placed` by hitting the demo endpoint on orders-service:

```bash
curl -X POST http://localhost:4018/api/events-demo/orders \
  -H 'content-type: application/json' \
  -d '{
    "userId": "u1",
    "items": [
      {"sku": "sku-1", "quantity": 2, "unitPrice": 1000},
      {"sku": "sku-2", "quantity": 1, "unitPrice": 2500}
    ],
    "currency": "USD"
  }'
```

You'll see:

- **notifications-service** log the "order received" email.
- **payments-service** attempt a charge (90% success in the demo) → emit
  `payment.captured` or `payment.failed`.
- **inventory-service** try to reserve stock → emit `stock.reserved` or
  `stock.depleted` (the in-memory table depletes after ~5 identical SKU
  requests so both paths are reachable).
- **orders-service** react to whichever payment / inventory event arrives
  → emit `order.confirmed` or `order.cancelled`.
- **notifications-service** log the follow-up email.
- **analytics-service** log the revenue-recognition event on success.

## Observe

- **Xenosis dashboard** — the **Events** tab shows the full producer /
  consumer mesh, orphan topics, and unserved consumers.
- **Redpanda Console** at http://localhost:8086 — inspect topics, browse
  messages, watch consumer group lag.
- **Every service's stdout** — trace ids propagate through message
  headers, so a single order's fan-out shows up under one `traceId` across
  all five services.

## Tear it down

```bash
docker compose -f examples/ts/infra/docker-compose.yml down -v
```

`-v` also drops the Redpanda data volume so the next run starts clean.
