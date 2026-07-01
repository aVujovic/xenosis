import { z } from 'zod';

/**
 * The base Xenosis service config schema — the typed shape of
 * `xenosis.config.json`. It is `.passthrough()`, so unknown top-level keys are
 * kept (not stripped): a service may carry custom config without declaring it,
 * and forward-compat config survives an older core.
 *
 * Two ways to get type-safety for YOUR OWN config keys on top of these:
 *   1. Add a `src/config.schema.ts` to your service that default-exports
 *      `defineConfigSchema({ stripe: z.object({...}) })`. Xenosis auto-loads it
 *      at boot, validates against it, and your keys are typed + checked.
 *   2. Import `XenosisConfig` for the base shape alone.
 *
 * Validation runs fail-fast at boot (see config.loader): a malformed config
 * aborts startup with a precise error (which key, what was expected) instead of
 * surfacing as `undefined` deep inside a loader at runtime.
 */

const reliabilitySchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z
    .object({
      attempts: z.number().int().nonnegative(),
      backoffMs: z.number().int().nonnegative().optional(),
      retryOnStatus: z.array(z.number().int()).optional(),
    })
    .optional(),
  circuitBreaker: z
    .object({
      failureThreshold: z.number().int().positive(),
      resetMs: z.number().int().positive().optional(),
    })
    .optional(),
});

const peerBindingSchema = reliabilitySchema.extend({
  package: z.string(),
  transport: z.literal('http'),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  bodyEncoding: z.enum(['json', 'form-urlencoded']).optional(),
});

const connectorSchema = z
  .object({ type: z.string() })
  .passthrough(); // per-connector fields vary by type; adapters validate their own subset

const schemaBindingSchema = z.object({
  package: z.string(),
  connector: z.string(),
});

/**
 * A WebSocket binding — analogous to a peer binding, but for the sockets
 * stack. Resolves a SocketApi definition (from an `@scope/<name>-socket-api`
 * package, default-exported via `defineSocketApi`) and mounts a handler
 * found by autoload at `src/sockets/<name>.socket.ts`.
 */
const socketBindingSchema = z.object({
  /** npm package that default-exports a `SocketApi` via `defineSocketApi`. */
  package: z.string(),
  /** Override the path declared in the SocketApi (optional). */
  path: z.string().optional(),
  /** Transport provider. Either the literal "ws" (built-in default) or an
   *  npm package name that default-exports a `SocketTransport` — e.g.
   *  "@xenosisorg/socket-transport-socketio". Omit for "ws". */
  transport: z.string().optional(),
  /** Provider-specific options forwarded verbatim to `transport.mount`.
   *  For "ws": `{ heartbeatMs: number }`. Other transports document their
   *  own shape. */
  transportOptions: z.record(z.unknown()).optional(),
  /** When true, the connection must present a valid JWT (query param
   *  `?token=<...>` or via `Sec-WebSocket-Protocol`). Default: false. */
  requireAuth: z.boolean().optional(),
  /** Max concurrent connections per authenticated user. Excess connects
   *  are rejected with 401. Unlimited when omitted. */
  maxConnectionsPerUser: z.number().int().positive().optional(),
  /** Inbound message validation mode. Default: `'strict'` — every message
   *  whose `type` matches a key in `clientMessages` is run through that
   *  zod schema; payload failures are rejected before the handler is
   *  invoked. Set `'off'` to skip the schema step and pass the raw parsed
   *  body straight through (useful when migrating code that already
   *  validates by hand, or when the SocketApi declares no schemas yet). */
  validation: z.enum(['strict', 'off']).optional(),
});

/**
 * An event API binding — the async counterpart to a peer / socket binding.
 * Resolves an `EventApi` definition from an `@scope/<name>-events` package
 * and wires it to one of the registered transports (kafka, redpanda, nats,
 * redis-streams, memory, or a third-party `@scope/event-transport-x` npm
 * package).
 */
const eventBindingSchema = z.object({
  /** npm package that default-exports an `EventApi` via `defineEventApi`. */
  package: z.string(),
  /** Transport provider name. Built-in: `'kafka' | 'redpanda' | 'nats' |
   *  'redis-streams' | 'memory'`. Any other string is dynamic-imported as an
   *  npm package whose default export is an `EventTransportProvider`. */
  transport: z.string(),
  /** Cradle key of a connector / client this transport should reuse, when
   *  applicable (e.g. `connectors.kafka` for kafka transport,
   *  `connectors.redis` for redis-streams). Optional — transports that take
   *  their config inline don't need this. */
  connector: z.string().optional(),
  /** Inline transport-specific options forwarded to `createProducer` /
   *  `createConsumer`. Shape varies by transport; each transport documents
   *  its own subset. */
  transportOptions: z.record(z.unknown()).optional(),
  /** Producer / consumer / both. Default `'both'` — a service that imports
   *  the api package usually wants symmetric publish + consume. */
  mode: z.enum(['producer', 'consumer', 'both']).optional(),
  /** Consumer group id (transports that need one). Default
   *  `${config.name}-${bindingName}` — explicit override is recommended for
   *  production so blue/green rollouts don't accidentally reuse the same group. */
  groupId: z.string().optional(),
  /** Read from the earliest available message on first consumer connect.
   *  Default `false` — services pick up only NEW messages on cold start. */
  fromBeginning: z.boolean().optional(),
  /** Inbound message validation mode. Default `'strict'` — every consumed
   *  message is run through the topic's zod schema; failures dead-letter the
   *  message (logged, ack'd, not handed to the handler). `'off'` skips zod
   *  for migrations where the producer-side schema is still drifting. */
  validation: z.enum(['strict', 'off']).optional(),
});

export const xenosisConfigSchema = z
  .object({
    name: z.string().optional(),
    /** Short peer identity (peers cradle key + allowedCallers + x-xenosis-caller). */
    peerName: z.string().optional(),
    env: z.enum(['development', 'staging', 'production']).optional(),
    logLevel: z.enum(['error', 'warn', 'info', 'debug', 'trace', 'fatal']).optional(),
    port: z.number().int().positive().optional(),
    allowedOrigins: z.array(z.string()).optional(),
    serverOptions: z
      .object({ bodySizeLimit: z.union([z.string(), z.number()]).optional() })
      .passthrough()
      .optional(),
    requestLog: z.enum(['start', 'end', 'both', 'off']).optional(),
    auth: z.object({}).passthrough().optional(), // userland JWT block — shape is the app's
    connectors: z.record(connectorSchema).optional(),
    schemas: z.record(schemaBindingSchema).optional(),
    peers: z.record(peerBindingSchema).optional(),
    sockets: z.record(socketBindingSchema).optional(),
    events: z.record(eventBindingSchema).optional(),
    boundaries: z
      .object({ allowedCallers: z.array(z.string()).optional() })
      .optional(),
    authentication: z
      .object({
        enabled: z.boolean().optional(),
        token: z.string().optional(),
        exempt: z.array(z.string()).optional(),
      })
      .optional(),
    openapi: z
      .object({
        enabled: z.boolean().optional(),
        path: z.string().optional(),
        jsonPath: z.string().optional(),
        title: z.string().optional(),
        version: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /**
     * HTTP framework selection. Defaults to Express. Set `framework: "hono"` to
     * run the service on Hono + @hono/node-server (peer deps; install them in
     * the service when opting in). Same XServer contract, same user code.
     */
    http: z
      .object({
        framework: z.enum(['express', 'hono']).optional(),
      })
      .optional(),
  })
  .passthrough();

/** The typed shape of `xenosis.config.json` (base Xenosis keys). */
export type XenosisConfig = z.infer<typeof xenosisConfigSchema>;

/**
 * Extend the base config schema with your own typed keys. Default-export the
 * result from `src/config.schema.ts` and Xenosis validates the merged shape at
 * boot.
 *
 *   // src/config.schema.ts
 *   import { defineConfigSchema, z } from '@xenosisorg/xenosis-core';
 *   export default defineConfigSchema({
 *     stripe: z.object({ secretKey: z.string() }),
 *   });
 *   // → config.stripe.secretKey is typed and validated alongside Xenosis keys.
 */
export function defineConfigSchema<T extends z.ZodRawShape>(shape: T) {
  return xenosisConfigSchema.extend(shape);
}
