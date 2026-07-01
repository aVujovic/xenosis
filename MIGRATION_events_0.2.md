# Migrating events to Xenosis 0.2 (atomic contract)

Xenosis 0.2 makes every event binding an **atomic contract**: the
`publishes` and `consumes` lists in `xenosis.config.json` must exactly
match what your code does. TypeScript blocks `.publish()` outside the
whitelist, the events loader refuses to boot on any drift, and
`xenosis events verify` fails CI when config and code disagree.

If you were on **0.1.x** with events already wired up (or wrote a
one-off pub/sub layer against `connectors.kafka` directly), this guide
takes you to 0.2 in about **10 minutes per service**.

## Prerequisites

Bump every package to `0.2.0` first:

```bash
pnpm add @xenosisorg/xenosis-core@^0.2.0
pnpm add -D @xenosisorg/xenosis-cli@^0.2.0
```

(`xenosis-testing` stays on `0.1.x` — it's compatible.)

Confirm you're on the new CLI:

```bash
pnpm exec xenosis --help | head -20
# Should list `events verify` alongside `graph`.
```

## The three paths

Pick the row that describes your current state:

| You were on… | Effort | Steps |
|---|---|---|
| Xenosis 0.1.x with `events.<binding>` config | ~5 min / service | Skip to [Path A](#path-a-you-already-use-xenosis-events). |
| Custom kafkajs / ioredis pub/sub against `connectors.kafka` | ~20 min / service | Read [Path B](#path-b-you-rolled-your-own). |
| No events at all yet | Nothing to migrate | Read [`xenosis.org/docs/events/`](https://xenosis.org/docs/events/) to add from scratch. |

---

## Path A — you already use Xenosis events

Existing 0.1.x events bindings work syntactically on 0.2, but boot fails
until every one declares `publishes` / `consumes`. One command
autopopulates both from the code you already have.

### 1. Run `--fix` in each service

```bash
cd services/orders-service
pnpm exec xenosis events verify --fix
```

`--fix`:

- scans `src/**` for `events.<binding>.<topic>.publish(` call sites →
  writes them into `publishes`;
- scans `src/events/*.event.ts` for `defineEventHandler(...)` bindings →
  writes them into `consumes`;
- removes `publishes` / `consumes` from bindings whose mode forbids them
  (so a `mode: "consumer"` binding never keeps a stale `publishes`).

The result is a fully migrated `xenosis.config.json`. Diff it, commit it.

### 2. Re-verify to confirm

```bash
pnpm exec xenosis events verify
# ✓ All N service(s) are atomic-consistent.
```

If `--fix` left anything unresolved (rare — usually a genuine drift like
"consumes references a topic that no longer exists in the api package"),
you'll get a precise error path and message. Fix and re-run.

### 3. Add to CI

```yaml
# .github/workflows/ci.yml
- run: pnpm exec xenosis events verify --workspace
```

`--workspace` extends the check across services and flags:

- **orphan topics** — a service publishes but nobody in the workspace
  consumes → dead broadcast, drop the topic or add a consumer;
- **unserved consumers** — a handler exists but nobody in the workspace
  emits → zombie handler, delete it or wire the producer up.

### 4. (Optional) Adopt the narrow producer type

Cradle deps used to be typed with the wide `EventBus<TApi>`:

```ts
// legacy
import type { EventBus } from '@xenosisorg/xenosis-core';
import type ordersEvents from '@example/orders-events';

constructor(private deps: {
  events: { orders: EventBus<typeof ordersEvents> };
}) {}
```

The wide type lets TypeScript compile `.publish()` on topics that
aren't in `publishes` — the property just fails at runtime. To catch
those at compile time, switch to `ProducerBus<T, K>`:

```ts
// atomic
import type { ProducerBus } from '@xenosisorg/xenosis-core';
import type ordersEvents from '@example/orders-events';

constructor(private deps: {
  events: {
    orders: ProducerBus<
      typeof ordersEvents,
      'orderPlaced' | 'orderConfirmed' | 'orderCancelled'
    >;
  };
}) {}
```

Now `deps.events.orders.orderShipped.publish(...)` is a TypeScript error.
The union literal `'orderPlaced' | ...` must match the `publishes` list
in `xenosis.config.json`; keep them in sync, or let a follow-up codegen
step do it for you.

This step is optional — 0.2 works fine on the wide type. Adopt when a
service has enough topics that a typo would slip past code review.

That's Path A. `--fix` + one CI line + optional narrow type. Everything
else stays the same — same producer calls, same handler files, same
transport wiring.

---

## Path B — you rolled your own

If you were talking to Kafka / Redpanda / Redis Streams / NATS directly
through `connectors.kafka` (or ioredis, or `nats`, or a hand-rolled
consumer loop somewhere in `src/`), the migration replaces the ad-hoc
publish/consume with Xenosis's typed contract. It's the same work you'd
do to adopt events for the first time, so it's mostly a "port your
handlers" exercise.

### 1. Extract the contract into an event API package

For each topic you publish or consume, create an `apis/<domain>-events/`
package. `xenosis create event-api` does the scaffolding:

```bash
xenosis create event-api orders
# → apis/orders-events/  (package.json + src/index.ts template)
```

Fill in the topics with zod schemas that match what you currently send
on the wire:

```ts
// apis/orders-events/src/index.ts
import { defineEventApi, z } from '@xenosisorg/xenosis-core';

export default defineEventApi({
  name: 'orders-events',
  transport: 'kafka',                       // or redpanda / nats / redis-streams
  topics: {
    orderPlaced: {
      topic: 'orders.order.placed',         // KEEP the exact wire name
      key: z.object({ orderId: z.string() }),
      schema: z.object({
        orderId:  z.string(),
        userId:   z.string(),
        totalAmount: z.number().int().positive(),
        currency: z.string().length(3),
        placedAt: z.string().datetime(),
      }),
    },
    // ... one entry per topic you send or receive
  },
});
```

Two things worth being strict about here:

- **`topic` must equal the current wire name on the broker.** If you
  rename it, you lose consumer group offsets and every in-flight message
  in the retention window.
- **`schema` must accept every field currently on the wire.** If
  producers still send extra fields you don't schema-ize yet, run zod
  in `.passthrough()` mode until the producer is cleaned up. See
  [`schema drift` in the events docs](https://xenosis.org/docs/events/).

### 2. Declare the binding in each service

Replace the ad-hoc `connectors.kafka` producer/consumer wiring with an
`events.<binding>` binding. `publishes` and `consumes` are the atomic
contract — list only what this specific service does.

```jsonc
// services/orders-service/xenosis.config.json
{
  "connectors": {
    "kafka": { "type": "kafka", "brokers": ["localhost:29092"] }
  },
  "events": {
    "orders": {
      "package": "@example/orders-events",
      "transport": "kafka",                 // or redpanda / nats / redis-streams
      "connector": "kafka",                 // reuse connectors.kafka
      "mode": "producer",
      "publishes": ["orderPlaced", "orderConfirmed", "orderCancelled"]
    },
    "payments": {
      "package": "@example/payments-events",
      "transport": "kafka",
      "connector": "kafka",
      "mode": "consumer",
      "groupId": "orders-service-payments",
      "consumes": ["paymentCaptured", "paymentFailed"]
    }
  }
}
```

**Consumer groupId matters.** Set it to the same value your old ad-hoc
consumer used, or you'll re-process every message in the retention
window on first boot. If you're doing a blue/green migration, use a
different groupId on green so the two consumers don't compete.

### 3. Replace hand-rolled publishes with the cradle bus

```ts
// BEFORE — direct kafkajs
constructor(private deps: { kafka: KafkaConnection }) {}
async placeOrder(input) {
  const order = { id: 'x', ...input };
  await this.deps.kafka.producer!.send({
    topic: 'orders.order.placed',
    messages: [{
      key:   JSON.stringify({ orderId: order.id }),
      value: JSON.stringify(order),
    }],
  });
}

// AFTER — typed EventBus / ProducerBus
constructor(private deps: {
  events: {
    orders: ProducerBus<typeof ordersEvents, 'orderPlaced'>;
  };
}) {}
async placeOrder(input) {
  const order = { id: 'x', ...input };
  await this.deps.events.orders.orderPlaced.publish(
    { orderId: order.id },
    { orderId: order.id, ...order },
  );
}
```

Payload validation, trace propagation (`x-xenosis-trace-*` headers),
retry policy — all handled by Xenosis. Delete the direct producer
plumbing and the `connectors.kafka.producer` reference.

### 4. Replace hand-rolled consumers with autoloaded handlers

Move each hand-rolled consumer into `src/events/<Name>.event.ts` — one
handler per topic. Autoload picks them up at boot.

```ts
// BEFORE — hand-rolled kafkajs consumer loop somewhere in service.ts
kafka.consumer!.subscribe({ topic: 'payments.payment.captured', fromBeginning: false });
kafka.consumer!.run({
  eachMessage: async ({ message }) => {
    const payload = JSON.parse(message.value!.toString());
    await orderService.confirmOrder(payload.orderId);
  },
});

// AFTER — src/events/PaymentCaptured.event.ts
import { defineEventHandler } from '@xenosisorg/xenosis-core';
import paymentsEvents from '@example/payments-events';

export default defineEventHandler(
  paymentsEvents.topics.paymentCaptured,
  async (payload, ctx) => {
    // payload is zod-validated, typed from the schema
    ctx.logger.info({ orderId: payload.orderId }, 'confirming order');
    const orderService = ctx.scope.cradle.orderService;
    await orderService.confirmOrder(payload.orderId);
  },
);
```

Delete the manual `subscribe`/`run` block from `service.ts` and the
`connectors.kafka.consumer` reference. Trace context, awilix
per-message scope, and schema validation all come from the loader.

### 5. Run `--fix` + verify

Once the code is ported, let the CLI double-check:

```bash
pnpm exec xenosis events verify --fix    # backfills anything you missed
pnpm exec xenosis events verify --workspace
```

Fix any errors it prints (they're always precise). Commit. Boot.

### 6. Remove the connector's producer/consumer mode (optional)

Once nothing hand-rolls kafka directly, you can drop the
`connectors.kafka.mode: "producer"` (or `"consumer"`) tag and let the
connector be pure config-only:

```jsonc
"connectors": {
  "kafka": { "type": "kafka", "brokers": ["localhost:29092"] }
  // no "mode" anymore — the events layer owns producers + consumers now
}
```

The connector stays because the events binding references it via
`"connector": "kafka"` to inherit broker / SASL / TLS config. It just
doesn't pre-instantiate a producer or consumer of its own.

---

## Rollback

If something breaks and you need to go back:

- **Config**: `publishes` / `consumes` are new fields; older cores just
  ignore them, so a `xenosis.config.json` migrated for 0.2 still boots
  on 0.1.x (with the ignored fields). Downgrade `xenosis-core` to
  `0.1.x` if you must — no config edits needed.
- **CI**: comment out the `xenosis events verify --workspace` step
  temporarily. The rest of the pipeline is unchanged.
- **Types**: `ProducerBus<T, K>` is only exported by 0.2. If you adopted
  the narrow type, revert to `EventBus<T>` for the downgrade window.

## Common gotchas

| Symptom | Cause |
|---|---|
| Boot fails with `mode="producer" requires "publishes" list` | You forgot to add the field. Run `xenosis events verify --fix`. |
| Boot fails with `"consumes" references topic not in api package` | Typo, or the api package version is older than the field. Bump the api package or fix the typo. |
| Boot fails with `handler(s) for [x] but "consumes" doesn't list them` | You added a `src/events/X.event.ts` without editing the config. Add it to `consumes`, or delete the file. |
| `--fix` didn't populate anything | Your `.publish()` calls use a non-standard alias. Rename to `events.<binding>.<topic>.publish(` or `<binding>Bus.<topic>.publish(` (the two patterns `--fix` recognises). |
| `verify --workspace` reports an orphan topic | A service publishes but nobody consumes. Add a consumer, or remove the topic from the api package + `publishes` list. |
| Consumer replays every historical message on first boot | Your `groupId` doesn't match the old consumer. Either restore the old groupId, or set `"fromBeginning": false` (default) and accept the gap. |

## See also

- [`xenosis.org/docs/events/`](https://xenosis.org/docs/events/) — the
  events layer overview.
- [`CHANGELOG.md`](./CHANGELOG.md) — the full 0.2.0 release notes.
- `xenosis events verify --help` — flag reference.
