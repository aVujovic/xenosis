import { asValue, type AwilixContainer } from 'awilix';
import { glob } from 'glob';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ILogger } from '../types.js';
import type { XenosisConfig } from '../config.schema.js';
import {
  readTraceFromHeaders,
  newTrace,
  writeTraceHeaders,
  childSpan,
  CALLER_HEADER,
} from '../peers/tracing.js';
import type { TraceContext } from '../peers/types.js';
import type {
  BoundEventHandler,
  EventApi,
  EventBus,
  EventContext,
  EventTopicSpec,
} from './types.js';
import type {
  EventTransportConsumer,
  EventTransportProducer,
  EventTransportProvider,
  PublishMessage,
} from './transports/types.js';
import { kafkaTransport } from './transports/kafka.transport.js';
import { redpandaTransport } from './transports/redpanda.transport.js';
import { natsTransport } from './transports/nats.transport.js';
import { redisStreamsTransport } from './transports/redis-streams.transport.js';
import { inMemoryTransport } from './transports/in-memory.transport.js';

/**
 * Loader bridge between `xenosis.config.json.events`, the event API packages,
 * and the registered transports. Builds:
 *
 *   • A producer-side `events.<binding>` cradle entry typed as `EventBus<T>`,
 *     so `this.deps.events.billing.chargeSucceeded.publish(key, payload)` is
 *     typed end-to-end.
 *
 *   • A consumer pipeline that scans `src/events/<Name>.event.ts`, identifies
 *     which binding each handler belongs to (by the topic spec's package
 *     identity), and subscribes the transport with the right groupId.
 *
 *   • Trace propagation through message headers — `x-xenosis-trace-*` is
 *     added on publish and reconstructed on consume, so a published-event-
 *     then-consumed chain shows up as one trace in the dashboard.
 *
 *   • Graceful shutdown — every transport's `.disconnect()` runs in the
 *     central signals stack.
 *
 * The set of built-in transports is hard-coded below; third-party transports
 * registered as an npm package name in `config.events.<binding>.transport` are
 * resolved via dynamic import. That matches how socket transports work.
 */

const BUILTIN_TRANSPORTS: Record<string, EventTransportProvider> = {
  kafka: kafkaTransport,
  redpanda: redpandaTransport,
  nats: natsTransport,
  'redis-streams': redisStreamsTransport,
  memory: inMemoryTransport,
};

async function resolveTransport(name: string): Promise<EventTransportProvider> {
  const builtin = BUILTIN_TRANSPORTS[name];
  if (builtin) return builtin;
  try {
    const mod = (await import(name)) as {
      default?: EventTransportProvider;
      transport?: EventTransportProvider;
    };
    const t = mod.default ?? mod.transport;
    if (!t || typeof t !== 'object' || typeof t.createProducer !== 'function') {
      throw new Error(
        `package "${name}" must default-export an EventTransportProvider (got ${typeof t})`,
      );
    }
    return t;
  } catch (err) {
    throw new Error(
      `[xenosis/events] unknown transport "${name}". Built-in: ${Object.keys(BUILTIN_TRANSPORTS).join(', ')}. ` +
        `Or install an npm package whose default export is an EventTransportProvider. ` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

interface LoadedBinding {
  name: string;
  api: EventApi;
  transport: EventTransportProvider;
  producer: EventTransportProducer | undefined;
  consumer: EventTransportConsumer | undefined;
  mode: 'producer' | 'consumer' | 'both';
  groupId: string;
  validation: 'strict' | 'off';
  /** Explicit publish whitelist from config. Empty when mode is consumer-only. */
  publishes: string[];
  /** Explicit consume whitelist from config. Empty when mode is producer-only. */
  consumes: string[];
}

interface RawEventBinding {
  package: string;
  transport: string;
  connector?: string | undefined;
  transportOptions?: Record<string, unknown> | undefined;
  mode?: 'producer' | 'consumer' | 'both' | undefined;
  groupId?: string | undefined;
  fromBeginning?: boolean | undefined;
  validation?: 'strict' | 'off' | undefined;
  publishes?: string[] | undefined;
  consumes?: string[] | undefined;
}

/**
 * Fail-fast validation of the `publishes` / `consumes` contract at boot.
 *
 *   1. Producer / both binding must declare `publishes` (non-empty list).
 *   2. Consumer / both binding must declare `consumes` (non-empty list).
 *   3. Every topic key in the list must exist in the api package's
 *      `defineEventApi({ topics })` map — catches typos ("orderShiped").
 *
 * Handler-vs-consumes alignment is checked separately in Phase C once the
 * consumer handler files have been discovered.
 */
function validateBindingContract(
  bindingName: string,
  binding: RawEventBinding,
  api: EventApi,
  mode: 'producer' | 'consumer' | 'both',
): { publishes: string[]; consumes: string[] } {
  const apiTopics = new Set(Object.keys(api.topics));

  const publishes = binding.publishes ?? [];
  const consumes = binding.consumes ?? [];

  if (mode === 'producer' || mode === 'both') {
    if (publishes.length === 0) {
      throw new Error(
        `[xenosis/events] events.${bindingName}: mode="${mode}" requires a non-empty "publishes" list.\n` +
          `  Add every topic key from "${binding.package}" that this service emits:\n` +
          `    "publishes": [${Array.from(apiTopics)
            .map((t) => `"${t}"`)
            .join(', ')}]`,
      );
    }
    const unknown = publishes.filter((t) => !apiTopics.has(t));
    if (unknown.length > 0) {
      throw new Error(
        `[xenosis/events] events.${bindingName}: "publishes" references topic(s) not declared in ${binding.package}: ${unknown
          .map((t) => `"${t}"`)
          .join(', ')}.\n` +
          `  Available topics: ${Array.from(apiTopics)
            .map((t) => `"${t}"`)
            .join(', ')}`,
      );
    }
  } else if (publishes.length > 0) {
    throw new Error(
      `[xenosis/events] events.${bindingName}: mode="${mode}" cannot declare "publishes". Set mode to "producer" or "both".`,
    );
  }

  if (mode === 'consumer' || mode === 'both') {
    if (consumes.length === 0) {
      throw new Error(
        `[xenosis/events] events.${bindingName}: mode="${mode}" requires a non-empty "consumes" list.\n` +
          `  Add every topic key from "${binding.package}" this service listens to.`,
      );
    }
    const unknown = consumes.filter((t) => !apiTopics.has(t));
    if (unknown.length > 0) {
      throw new Error(
        `[xenosis/events] events.${bindingName}: "consumes" references topic(s) not declared in ${binding.package}: ${unknown
          .map((t) => `"${t}"`)
          .join(', ')}.\n` +
          `  Available topics: ${Array.from(apiTopics)
            .map((t) => `"${t}"`)
            .join(', ')}`,
      );
    }
  } else if (consumes.length > 0) {
    throw new Error(
      `[xenosis/events] events.${bindingName}: mode="${mode}" cannot declare "consumes". Set mode to "consumer" or "both".`,
    );
  }

  return { publishes, consumes };
}

export interface EventsLoadResult {
  /** Graceful-shutdown hooks — called from Commands.start. */
  disconnects: Array<() => Promise<void>>;
}

export async function loadEvents(
  container: AwilixContainer,
  config: XenosisConfig,
  logger: ILogger,
  opts: { cwd?: string } = {},
): Promise<EventsLoadResult> {
  const eventsConfig = config.events ?? {};
  const bindingNames = Object.keys(eventsConfig);

  if (bindingNames.length === 0) {
    // Always register an empty `events` cradle key so consumers can depend on
    // it unconditionally (mirrors `socketBus`).
    container.register({ events: asValue({}) });
    return { disconnects: [] };
  }

  const cwd = opts.cwd ?? process.cwd();
  const bindings: LoadedBinding[] = [];
  const disconnects: Array<() => Promise<void>> = [];

  // ─── Phase A: resolve packages, build producers + consumers ───────────────

  for (const name of bindingNames) {
    const binding = eventsConfig[name]!;
    const api = await importEventApi(binding.package, cwd);
    const transport = await resolveTransport(binding.transport);
    const mode = binding.mode ?? 'both';
    const groupId =
      binding.groupId ?? `${config.name ?? 'xenosis-service'}-${name}`;
    const validation = binding.validation ?? 'strict';

    // Atomic contract check: publishes/consumes lists must be present when
    // the mode calls for them AND every topic key must exist in the api.
    const { publishes, consumes } = validateBindingContract(
      name,
      binding,
      api,
      mode,
    );

    // Resolve transportOptions. If `connector` is set, pull the connector's
    // resolved config from the cradle and merge — that lets a binding share
    // a kafka client config block with `connectors.kafka` without duplication.
    const transportConfig = buildTransportConfig(
      binding.transportOptions,
      binding.connector,
      config,
      groupId,
    );

    let producer: EventTransportProducer | undefined;
    if (mode === 'producer' || mode === 'both') {
      producer = await transport.createProducer(transportConfig, { logger });
      disconnects.push(() => producer!.disconnect());
    }

    let consumer: EventTransportConsumer | undefined;
    if (mode === 'consumer' || mode === 'both') {
      consumer = await transport.createConsumer(transportConfig, { logger });
      disconnects.push(() => consumer!.disconnect());
    }

    bindings.push({
      name,
      api,
      transport,
      producer,
      consumer,
      mode,
      groupId,
      validation,
      publishes,
      consumes,
    });

    logger.info(
      {
        binding: name,
        package: binding.package,
        transport: binding.transport,
        mode,
        groupId,
        topics: Object.keys(api.topics).length,
      },
      `📡 Event API loaded: events.${name} ← ${binding.package} (transport=${binding.transport}, mode=${mode})`,
    );
  }

  // ─── Phase B: register the `events` cradle as a map of EventBus per binding ───

  const eventsCradle: Record<string, EventBus<EventApi>> = {};
  for (const b of bindings) {
    if (!b.producer) {
      // Consumer-only binding — bus exposes NO publish methods (empty object).
      // Attempting `events.<binding>.<topic>.publish(...)` fails with undefined
      // property, mirroring the TS-level ConsumerBus type.
      eventsCradle[b.name] = {} as EventBus<EventApi>;
      continue;
    }
    // Narrow the bus to ONLY the topics in `publishes`. Topics outside the
    // list have no publish() method; typos and drift fail loud, immediately.
    eventsCradle[b.name] = buildEventBus(
      b.api,
      b.producer,
      b.publishes,
      makeRootTraceProvider(container),
      logger,
    );
  }
  container.register({ events: asValue(eventsCradle) });

  // ─── Phase C: discover consumer handlers from src/events/ ────────────────

  const handlers = await discoverConsumerHandlers(cwd, logger);

  // Group handlers by binding (via topic spec object identity match against
  // each binding's api.topics).
  const handlersByBinding = groupHandlersByBinding(handlers, bindings, logger);

  // ─── Phase C.5: atomic contract enforcement — consumes must equal handlers ─
  //
  // For every binding that consumes, the set of handler files under
  // `src/events/` MUST equal the `consumes` list from config. If a handler
  // exists but isn't in consumes → the service is silently listening for an
  // event it hasn't declared it wants. If consumes has a topic but no handler
  // exists → the service claims to listen but nothing runs. Either is a real
  // bug; both are boot-blocking.
  for (const b of bindings) {
    if (!(b.mode === 'consumer' || b.mode === 'both')) continue;

    const declaredConsumes = new Set(b.consumes);
    const handlerList = handlersByBinding.get(b.name) ?? [];
    // The topic KEY on the spec is what config uses; find each handler's key
    // by matching the topic spec object identity against the api.topics map.
    const handlerTopicKeys = new Set<string>();
    for (const h of handlerList) {
      for (const [key, spec] of Object.entries(b.api.topics)) {
        if (spec === h.handler.topic) {
          handlerTopicKeys.add(key);
          break;
        }
      }
    }

    const missingHandlers = [...declaredConsumes].filter(
      (t) => !handlerTopicKeys.has(t),
    );
    const undeclaredHandlers = [...handlerTopicKeys].filter(
      (t) => !declaredConsumes.has(t),
    );

    if (missingHandlers.length > 0 || undeclaredHandlers.length > 0) {
      const lines: string[] = [
        `[xenosis/events] events.${b.name}: config/code contract mismatch.`,
      ];
      if (missingHandlers.length > 0) {
        lines.push(
          `  ✗ consumes declares [${missingHandlers.map((t) => `"${t}"`).join(', ')}] but no matching src/events/*.event.ts handler exists.`,
        );
        lines.push(
          `    Add a defineEventHandler for each, or remove them from "consumes".`,
        );
      }
      if (undeclaredHandlers.length > 0) {
        lines.push(
          `  ✗ src/events/ has handler(s) for [${undeclaredHandlers.map((t) => `"${t}"`).join(', ')}] but "consumes" does not list them.`,
        );
        lines.push(
          `    Add them to "consumes" in xenosis.config.json, or delete the handler file.`,
        );
      }
      throw new Error(lines.join('\n'));
    }
  }

  if (handlers.length === 0) {
    return { disconnects };
  }

  // ─── Phase D: subscribe each binding's consumer to its topics ────────────

  for (const b of bindings) {
    if (!b.consumer) continue;
    const handlerList = handlersByBinding.get(b.name) ?? [];
    if (handlerList.length === 0) continue;

    const wireTopics = handlerList.map((h) => h.handler.topic.topic);
    const handlerByWireTopic = new Map<
      string,
      Array<{ topicKey: string; handler: BoundEventHandler }>
    >();
    for (const h of handlerList) {
      const list = handlerByWireTopic.get(h.handler.topic.topic) ?? [];
      list.push(h);
      handlerByWireTopic.set(h.handler.topic.topic, list);
    }

    await b.consumer.subscribe(
      {
        topics: Array.from(new Set(wireTopics)),
        groupId: b.groupId,
        fromBeginning: eventsConfig[b.name]?.fromBeginning ?? false,
      },
      async (msg) => {
        const handlers = handlerByWireTopic.get(msg.topic);
        if (!handlers || handlers.length === 0) {
          logger.warn(
            { topic: msg.topic, binding: b.name },
            '[xenosis/events] no handler registered for topic',
          );
          await msg.ack();
          return;
        }

        // Decode + validate once, then fan out to every handler subscribed.
        // Typically there's just one handler per (binding, topic) but the
        // loader does not enforce that — it's useful for inline test fanout.
        let decoded: unknown;
        try {
          decoded = JSON.parse(msg.value.toString('utf8'));
        } catch (err) {
          logger.error(
            { err: (err as Error).message, topic: msg.topic, messageId: msg.messageId },
            '[xenosis/events] message value is not valid JSON — dropping',
          );
          await msg.ack();
          return;
        }

        for (const { handler } of handlers) {
          let payload = decoded;
          if (b.validation === 'strict') {
            const parsed = await handler.topic.schema.safeParseAsync(decoded);
            if (!parsed.success) {
              logger.error(
                {
                  topic: msg.topic,
                  messageId: msg.messageId,
                  issues: parsed.error.issues,
                },
                '[xenosis/events] payload failed schema validation — dropping',
              );
              await msg.ack();
              continue;
            }
            payload = parsed.data;
          }

          // Reconstruct trace context from headers (or mint fresh).
          const inboundTrace = readTraceFromHeaders(msg.headers as Record<string, string>);
          const baseTrace: TraceContext = inboundTrace ?? newTrace();
          // Each handler invocation gets its own child span so the dashboard
          // shows the consume as a discrete step under the produce.
          const handlerTrace = childSpan(baseTrace);

          const scope = container.createScope();
          const handlerLogger = logger.child({
            traceId: handlerTrace.traceId,
            spanId: handlerTrace.spanId,
            ...(handlerTrace.parentSpanId ? { parentSpanId: handlerTrace.parentSpanId } : {}),
            topic: msg.topic,
            messageId: msg.messageId,
          });
          scope.register({
            traceContext: asValue(handlerTrace),
            requestLogger: asValue(handlerLogger),
          });

          // Build a scope-aware `events` cradle key so any .publish() the
          // handler makes carries THIS message's trace forward — that's what
          // makes end-to-end trace propagation work across the mesh. Reuses
          // the transport producers already created in Phase A.
          const peerName = config.peerName ?? config.name;
          const scopedEvents: Record<string, EventBus<EventApi>> = {};
          for (const otherBinding of bindings) {
            if (!otherBinding.producer) {
              scopedEvents[otherBinding.name] = {} as EventBus<EventApi>;
              continue;
            }
            scopedEvents[otherBinding.name] = buildEventBus(
              otherBinding.api,
              otherBinding.producer,
              otherBinding.publishes,
              makeScopeTraceProvider(scope, peerName),
              logger,
            );
          }
          scope.register({ events: asValue(scopedEvents) });

          const ctx: EventContext = {
            messageId: msg.messageId,
            topic: msg.topic,
            key: msg.key,
            headers: msg.headers,
            traceContext: handlerTrace,
            logger: handlerLogger,
            scope,
            partition: msg.partition,
            offset: msg.offset,
            timestamp: msg.timestamp,
          };

          try {
            await handler.handle(payload, ctx);
            handlerLogger.info(
              { topic: msg.topic, durationMs: msg.timestamp ? Date.now() - msg.timestamp : undefined },
              'event:handled',
            );
          } catch (err) {
            handlerLogger.error(
              { err: (err as Error).message, topic: msg.topic, messageId: msg.messageId },
              '[xenosis/events] handler threw',
            );
            // Re-raise to the transport so it can apply its retry / DLQ policy.
            try {
              await msg.nack(err);
            } catch {
              // nack errors are not actionable here.
            }
            return;
          }
        }

        await msg.ack();
      },
    );

    logger.info(
      { binding: b.name, topics: Array.from(new Set(wireTopics)), groupId: b.groupId },
      `🎧 Event consumer subscribed: events.${b.name}`,
    );
  }

  return { disconnects };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function importEventApi(packageName: string, cwd: string): Promise<EventApi> {
  // Try a node-resolution import first (the package is in node_modules).
  try {
    const mod = (await import(packageName)) as {
      default?: EventApi;
      api?: EventApi;
    };
    const api = mod.default ?? mod.api;
    if (!api?.name || !api?.topics) {
      throw new Error(
        `package "${packageName}" must default-export an EventApi via defineEventApi(...)`,
      );
    }
    return api;
  } catch (err) {
    // Fall through to filesystem resolve for workspace-link cases where the
    // dynamic import resolution differs from node_modules.
    const candidates = [
      join(cwd, 'node_modules', packageName, 'src', 'index.ts'),
      join(cwd, 'node_modules', packageName, 'dist', 'index.js'),
    ];
    for (const c of candidates) {
      try {
        const mod = (await import(pathToFileURL(c).href)) as {
          default?: EventApi;
        };
        if (mod.default?.name && mod.default.topics) return mod.default;
      } catch {
        // try next
      }
    }
    throw new Error(
      `[xenosis/events] could not import event API package "${packageName}": ${(err as Error).message}`,
    );
  }
}

function buildTransportConfig(
  inline: Record<string, unknown> | undefined,
  connectorRef: string | undefined,
  config: XenosisConfig,
  groupId: string,
): Record<string, unknown> {
  const fromConnector =
    connectorRef && config.connectors
      ? (config.connectors as Record<string, unknown>)[connectorRef]
      : undefined;
  return {
    ...(fromConnector && typeof fromConnector === 'object' ? fromConnector : {}),
    ...(inline ?? {}),
    groupId,
  };
}

/**
 * Build the producer-side bus with ONLY the topics in `publishes` present.
 * Callers that reference a topic outside the list get `undefined` back and
 * fail at runtime — matching the compile-time narrowing done by
 * `ProducerBus<TApi, K>` (see src/events/types.ts).
 *
 * The trace provider decides where the outbound message's trace headers come
 * from — the root cradle for a service-wide bus, or the handler's scope when
 * a consumer publishes downstream (so the inbound message's traceId propagates).
 */
function buildEventBus(
  api: EventApi,
  producer: EventTransportProducer,
  publishes: string[],
  traceProvider: TraceProvider,
  logger: ILogger,
): EventBus<EventApi> {
  const allowed = new Set(publishes);
  const bus: Record<string, unknown> = {};
  for (const [topicKey, spec] of Object.entries(api.topics)) {
    if (!allowed.has(topicKey)) continue;
    bus[topicKey] = {
      publish: makePublishFn(spec, producer, traceProvider, logger),
    };
  }
  return bus as EventBus<EventApi>;
}

/** Trace provider that reads from the root cradle (default for cradle key). */
function makeRootTraceProvider(container: AwilixContainer): TraceProvider {
  return () => readTracingFromCradle(container);
}

/** Trace provider that reads from a per-message scope (used inside consumer handlers). */
function makeScopeTraceProvider(
  scope: AwilixContainer,
  peerName: string | undefined,
): TraceProvider {
  return () => {
    let trace: TraceContext;
    try {
      trace = (scope.cradle as { traceContext?: TraceContext }).traceContext ?? newTrace();
    } catch {
      trace = newTrace();
    }
    return { trace, peerName };
  };
}

// Legacy consumer-only bus builder kept as a reference for the historical
// throw-on-call behaviour; the new loader replaces this with an empty object
// (see Phase B in loadEvents above). If a service still expects the old
// behaviour, it can call this manually.
function _legacyConsumerOnlyBus(api: EventApi, bindingName: string): EventBus<EventApi> {
  const bus: Record<string, unknown> = {};
  for (const topicKey of Object.keys(api.topics)) {
    bus[topicKey] = {
      publish: async () => {
        throw new Error(
          `[xenosis/events] events.${bindingName}.${topicKey}.publish() called on a consumer-only binding. ` +
            `Set "mode": "producer" or "both" in xenosis.config.json events.${bindingName}.`,
        );
      },
    };
  }
  return bus as EventBus<EventApi>;
}

/**
 * Provider that resolves the trace context to stamp on outbound messages.
 * The default (root container) reads from the process-wide cradle so
 * background publishes from a cron job still get a synthetic trace. Handler
 * bindings override this with a scope-aware provider so that publishes from
 * inside a consumer handler carry the *inbound message's* trace forward —
 * that's what makes end-to-end trace propagation work across services.
 */
type TraceProvider = () => {
  trace: TraceContext;
  peerName: string | undefined;
};

function makePublishFn(
  spec: EventTopicSpec,
  producer: EventTransportProducer,
  traceProvider: TraceProvider,
  logger: ILogger,
) {
  return async (...args: unknown[]) => {
    let key: unknown;
    let payload: unknown;
    let opts: { headers?: Record<string, string>; partition?: number } = {};

    if (spec.key) {
      key = args[0];
      payload = args[1];
      opts = (args[2] as typeof opts) ?? {};
      const parsedKey = await spec.key.safeParseAsync(key);
      if (!parsedKey.success) {
        throw new Error(
          `[xenosis/events] publish(${spec.topic}): key failed schema — ${JSON.stringify(parsedKey.error.issues)}`,
        );
      }
      key = parsedKey.data;
    } else {
      payload = args[0];
      opts = (args[1] as typeof opts) ?? {};
    }

    const parsed = await spec.schema.safeParseAsync(payload);
    if (!parsed.success) {
      throw new Error(
        `[xenosis/events] publish(${spec.topic}): payload failed schema — ${JSON.stringify(parsed.error.issues)}`,
      );
    }

    // Trace propagation — the provider knows how to reach the right context
    // (handler scope inside a consumer, root cradle inside a background job).
    const tracing = traceProvider();
    const traceHeaders = writeTraceHeaders(tracing.trace);
    const callerHeaders: Record<string, string> = tracing.peerName
      ? { [CALLER_HEADER]: tracing.peerName }
      : {};

    const message: PublishMessage = {
      topic: spec.topic,
      value: Buffer.from(JSON.stringify(parsed.data), 'utf8'),
      ...(key !== undefined
        ? { key: typeof key === 'string' ? key : JSON.stringify(key) }
        : {}),
      headers: { ...traceHeaders, ...callerHeaders, ...(opts.headers ?? {}) },
      ...(opts.partition !== undefined ? { partition: opts.partition } : {}),
    };

    try {
      await producer.publish(message);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, topic: spec.topic },
        '[xenosis/events] publish failed',
      );
      throw err;
    }
  };
}

function readTracingFromCradle(container: AwilixContainer): {
  trace: TraceContext;
  peerName: string | undefined;
} {
  // Reads the current trace context from the root cradle if a per-request
  // scope hasn't been pushed (e.g. publishing from a background job). When
  // inside a request, the per-request scope shadows this with its own
  // traceContext via AsyncLocalStorage on the HTTP side; here we read what's
  // currently visible to whoever called publish.
  let trace: TraceContext;
  try {
    trace = (container.cradle as { traceContext?: TraceContext }).traceContext ?? newTrace();
  } catch {
    trace = newTrace();
  }
  let peerName: string | undefined;
  try {
    const cfg = (container.cradle as { config?: XenosisConfig }).config;
    peerName = cfg?.peerName ?? cfg?.name;
  } catch {
    peerName = undefined;
  }
  return { trace, peerName };
}

// ─── Consumer handler discovery (autoload `src/events/*.event.ts`) ───────────

interface DiscoveredHandler {
  file: string;
  topicKey: string; // matched JS topic key from the binding's api.topics
  handler: BoundEventHandler;
}

async function discoverConsumerHandlers(
  cwd: string,
  logger: ILogger,
): Promise<DiscoveredHandler[]> {
  const eventsDir = resolve(cwd, 'src', 'events');
  const patterns = [
    join(eventsDir, '*.event.ts'),
    join(eventsDir, '*.event.js'),
    join(eventsDir, '**/*.event.ts'),
    join(eventsDir, '**/*.event.js'),
  ];

  const files = (
    await Promise.all(patterns.map((p) => glob(p, { absolute: true })))
  ).flat();
  const unique = Array.from(new Set(files));
  if (unique.length === 0) return [];

  const out: DiscoveredHandler[] = [];
  for (const file of unique) {
    try {
      const mod = (await import(pathToFileURL(file).href)) as {
        default?: BoundEventHandler;
      };
      const handler = mod.default;
      if (
        !handler ||
        typeof handler !== 'object' ||
        (handler as BoundEventHandler).__xenosisEventHandler !== true
      ) {
        logger.warn(
          { file },
          '[xenosis/events] file does not default-export a defineEventHandler(...) result — skipped',
        );
        continue;
      }
      out.push({ file, topicKey: '', handler });
    } catch (err) {
      logger.error(
        { file, err: (err as Error).message },
        '[xenosis/events] failed to import event handler file',
      );
    }
  }
  return out;
}

function groupHandlersByBinding(
  handlers: DiscoveredHandler[],
  bindings: LoadedBinding[],
  logger: ILogger,
): Map<string, DiscoveredHandler[]> {
  const out = new Map<string, DiscoveredHandler[]>();

  for (const dh of handlers) {
    // Find the binding whose api.topics contains this topic spec (by object
    // identity — the user imports it from the api package, so the reference
    // is the same across producer and consumer).
    let matched: { binding: LoadedBinding; topicKey: string } | undefined;
    for (const b of bindings) {
      for (const [key, spec] of Object.entries(b.api.topics)) {
        if (spec === dh.handler.topic) {
          matched = { binding: b, topicKey: key };
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      logger.warn(
        { file: dh.file, topic: dh.handler.topic.topic },
        '[xenosis/events] handler references a topic that is not declared in any config.events binding — skipped',
      );
      continue;
    }

    const list = out.get(matched.binding.name) ?? [];
    list.push({ ...dh, topicKey: matched.topicKey });
    out.set(matched.binding.name, list);
  }

  return out;
}
