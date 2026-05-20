import type { ZodSchema } from 'zod';

/**
 * HTTP verb supported by V1 transport.
 * Pub/sub semantics (publish/subscribe) arrive in V1.1 alongside RabbitMQ.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Route specification for a single API method.
 *
 * Path params follow Express-style `:param` syntax. The Proxy client matches
 * input field names to `:param` placeholders — e.g. for `path: '/charges/:id'`,
 * the input object must contain `{ id: string, ... }`. Matched fields are
 * extracted from the body before the request is sent.
 *
 * `bodySchema` / `responseSchema` are optional zod schemas. When present:
 *  - Server (`mountPeerApi`): validates inbound request body before handler.
 *  - Client (`createPeerClient`): optionally validates outbound input + parsed response.
 */
export interface RouteSpec<TInput = unknown, TOutput = unknown> {
  method: HttpMethod;
  path: string;
  bodySchema?: ZodSchema<TInput>;
  responseSchema?: ZodSchema<TOutput>;
}

/** How outbound request body is encoded on the wire. */
export type BodyEncoding = 'json' | 'form-urlencoded';

/**
 * Maps a non-2xx response from an external API into a thrown error. Lives on
 * the PeerApi (not on the binding) because the API author knows the remote
 * error shape. If omitted, Xenosis throws `PeerHttpError` with the raw body.
 */
export type ErrorMapper = (status: number, body: unknown) => Error;

/**
 * Full peer API contract. Lives in a shared npm package
 * (e.g. `@example/billing-api`) and is imported by both caller and callee.
 *
 * - `name`   identifies the peer in logs and tracing.
 * - `routes` maps interface method name → RouteSpec.
 *
 * The generic `TApi` is the consumer's interface — e.g. `interface BillingApi`.
 * Routes type-check that every method on TApi has a corresponding route entry.
 *
 * For third-party APIs (Stripe, Twilio, …) declare `external: true`. External
 * APIs are stored under `apis/xenosis-custom/` and CLI tooling treats them as
 * user-owned. They may also override `bodyEncoding` (e.g. Stripe uses form)
 * and provide an `errorMapper` to normalise vendor error envelopes.
 */
export interface PeerApi<TApi extends Record<string, (...args: any[]) => Promise<any>>> {
  name: string;
  routes: { [K in keyof TApi]: RouteSpec<Parameters<TApi[K]>[0], Awaited<ReturnType<TApi[K]>>> };
  /** Marks this contract as a third-party API not owned by this codebase. */
  external?: boolean;
  /** Default body encoding for all routes. Default: 'json'. */
  bodyEncoding?: BodyEncoding;
  /** Maps non-2xx responses into thrown errors. Default: throw PeerHttpError. */
  errorMapper?: ErrorMapper;
}

/**
 * Type-safe RPC client. The Proxy returned by `createPeerClient` exposes every
 * method declared on TApi; calling one performs the underlying transport request
 * matching the route spec.
 *
 * Example: for `interface BillingApi { createCharge(input): Promise<{id}> }`,
 * `client.createCharge({...})` becomes `POST /api/v1/charges` body=`{...}`.
 */
export type PeerClient<TApi extends Record<string, (...args: any[]) => Promise<any>>> = {
  [K in keyof TApi]: TApi[K];
};

/**
 * Handler bag passed to `mountPeerApi` on the provider side. Each entry receives
 * the validated input and returns the response (or throws an Exception).
 *
 * Server-side handlers are plain async functions — Xenosis wires them into Express
 * routes with the route spec, runs zod validation if `bodySchema` is set, and
 * delegates errors to the global `errorHandlerMiddleware`.
 */
export type PeerHandlers<TApi extends Record<string, (...args: any[]) => Promise<any>>> = {
  [K in keyof TApi]: (input: Parameters<TApi[K]>[0]) => Promise<Awaited<ReturnType<TApi[K]>>>;
};

/**
 * Retry / timeout / circuit-breaker knobs. All optional — sensible defaults apply.
 * Underlying implementation uses the `cockatiel` library.
 */
export interface ReliabilityConfig {
  /** Total request timeout in milliseconds. Default: 5000. */
  timeoutMs?: number;

  retry?: {
    /** Max retry attempts (does not count the initial request). Default: 0 (off). */
    attempts: number;
    /** Initial backoff in ms; doubles on each retry (exponential). Default: 200. */
    backoffMs?: number;
    /** HTTP status codes that trigger a retry. Default: [502, 503, 504]. */
    retryOnStatus?: number[];
  };

  circuitBreaker?: {
    /** Open after this many consecutive failures. Default: off. */
    failureThreshold: number;
    /** Time before transitioning from OPEN → HALF_OPEN. Default: 30000. */
    resetMs?: number;
  };
}

/**
 * Transport interface — adapter contract for moving a routed request to its peer.
 * V1 ships only `http`; V1.1 will add `rabbitmq` and `redis-stream` (pub/sub).
 */
export interface PeerTransport {
  /**
   * Execute a routed call. The peers proxy resolves path params, separates
   * body from path/query, and hands the resolved request to the transport.
   */
  execute<TResponse>(req: TransportRequest): Promise<TResponse>;
}

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  body?: unknown;
  headers: Record<string, string>;
  timeoutMs?: number;
  bodyEncoding?: BodyEncoding;
}

/**
 * Per-peer entry in `xenosis.config.json` under `peers.{name}`.
 *
 * `package` references the shared API package (must default-export a PeerApi).
 * `transport` selects the wire protocol; V1 supports only `'http'`.
 * Remaining fields are transport-specific.
 */
export type PeerBinding =
  | (PeerBindingBase & { transport: 'http'; baseUrl: string });

interface PeerBindingBase extends ReliabilityConfig {
  /** npm package name that exports the PeerApi metadata. */
  package: string;
  /**
   * Optional inbound auth token to be sent on every request as
   * `x-xenosis-peer-key`. V1.1 will add proper auth adapter.
   */
  apiKey?: string;
  /**
   * Custom outbound headers applied to every request to this peer. Useful
   * for third-party APIs that need bespoke auth (e.g. Stripe Authorization
   * header). Header names are case-insensitive; values are sent verbatim.
   */
  headers?: Record<string, string>;
  /**
   * Override the peer's default body encoding. If unset, the PeerApi's
   * `bodyEncoding` (or 'json' fallback) applies.
   */
  bodyEncoding?: BodyEncoding;
}

/**
 * Tracing context propagated through every peer call as `x-xenosis-trace-id` /
 * `x-xenosis-span-id` headers. Created at request boundary, threaded through cradle.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Inbound access control for a service. Declared under `boundaries` in
 * `xenosis.config.json`. When `allowedCallers` is set, peer calls (requests
 * carrying `x-xenosis-caller`) from any service not in the list are rejected
 * with 403. Omitting it leaves the service open to all callers.
 */
export interface Boundaries {
  allowedCallers?: string[];
}

/**
 * Simple shared-token gate for a service. Declared under `authentication` in
 * `xenosis.config.json`. When `enabled`, every inbound request must present the
 * matching `token` via `Authorization: Bearer <token>`, an `x-auth-token`
 * header, or a `?authToken=<token>` query param — otherwise 401.
 *
 * `/healthcheck` is always exempt; add more bypass path prefixes via `exempt`
 * (e.g. the OpenAPI spec + Swagger UI paths).
 */
export interface Authentication {
  enabled?: boolean;
  token?: string;
  exempt?: string[];
}
