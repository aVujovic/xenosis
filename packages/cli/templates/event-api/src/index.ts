import { defineEventApi, z } from '@xenosisorg/xenosis-core';

/**
 * Async event contract owned by {{nameKebab}}-service.
 *
 * Any service in the workspace that needs to publish or react to these
 * events imports this package, then:
 *
 *   • declares an `events.{{nameCamel}}` binding in xenosis.config.json
 *     (with `mode: "producer" | "consumer" | "both"` and explicit
 *     `publishes` / `consumes` topic lists — enforced at boot and by
 *     `xenosis events verify`), and
 *
 *   • for consumers, drops a `defineEventHandler(...)` in
 *     `src/events/<HandlerName>.event.ts` — autoload picks it up at boot.
 *
 * Wire topics use a dotted namespace so brokers (Kafka, Redpanda, NATS,
 * Redis Streams) can group them under a shared prefix and route by pattern.
 */
export default defineEventApi({
  name: '{{nameKebab}}-events',
  // Default transport — overridable per binding in xenosis.config.json.
  // Built-in: 'kafka' | 'redpanda' | 'nats' | 'redis-streams' | 'memory'.
  transport: 'kafka',
  description: 'Lifecycle events emitted by {{nameKebab}}-service.',
  topics: {
    // Example topic — rename and replace with your real events.
    somethingHappened: {
      topic: '{{nameKebab}}.something.happened',
      description: 'Something noteworthy happened in {{nameKebab}}-service.',
      key: z.object({ id: z.string() }),
      schema: z.object({
        id: z.string(),
        at: z.string().datetime(),
        // Add the rest of your payload fields here.
      }),
    },
  },
});
