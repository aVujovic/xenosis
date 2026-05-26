import type { IPolicy } from 'cockatiel';
import type {
  BodyEncoding,
  PeerApi,
  PeerClient,
  PeerTransport,
  RouteSpec,
  TraceContext,
} from './types';
import { PeerHttpError } from './reliability';
import { writeTraceHeaders, CALLER_HEADER } from './tracing';
import { emitPeerCallEvent, redactBody, truncateBody } from './telemetry';

interface CreatePeerClientOptions {
  api: PeerApi<any>;
  transport: PeerTransport;
  policy: IPolicy;
  /** Optional inbound API key sent as x-xenosis-peer-key. */
  apiKey?: string;
  /**
   * Custom outbound headers applied to every request (from PeerBinding.headers).
   * Useful for third-party APIs that need bespoke auth (e.g. Stripe Bearer).
   */
  customHeaders?: Record<string, string>;
  /** Override body encoding for this client. Falls back to api.bodyEncoding then 'json'. */
  bodyEncoding?: BodyEncoding;
  /**
   * This service's own name, sent as x-xenosis-caller on every outbound call so
   * the callee can enforce its `boundaries.allowedCallers`. Supplied by the
   * loaders from `config.name`.
   */
  callerName?: string;
  /**
   * Function that returns the current trace context. Allows the loader to
   * thread per-request context (set by trace middleware) into outbound calls.
   * If undefined, a fresh trace is generated per call.
   */
  getTraceContext?: () => TraceContext | undefined;
}

/**
 * Build a Proxy-based type-safe RPC client for a PeerApi.
 *
 * Each call to `client.<method>(input)`:
 *   1. Looks up the matching RouteSpec from `api.routes`.
 *   2. Resolves `:param` placeholders in the path against fields in `input`.
 *      Matched fields are removed from the body.
 *   3. Optionally validates `input` with `route.bodySchema` if present.
 *   4. Wraps the transport call in the reliability policy (retry/timeout/CB).
 *   5. Optionally parses the response with `route.responseSchema`.
 *
 * For external APIs, the PeerApi may declare `errorMapper` — non-2xx
 * `PeerHttpError`s are passed to it so callers see vendor-specific errors
 * (e.g. `Exception.PaymentRequired` for Stripe 402).
 */
export function createPeerClient<
  TApi extends Record<string, (...args: any[]) => Promise<any>>,
>(opts: CreatePeerClientOptions): PeerClient<TApi> {
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const route = (opts.api.routes as Record<string, RouteSpec>)[prop] as
          | RouteSpec
          | undefined;
        if (!route) {
          throw new Error(
            `[xenosis/peers] ${opts.api.name}: method "${String(prop)}" is not declared in PeerApi.routes`,
          );
        }
        return (input: unknown) => callRoute(opts, prop as string, route, input);
      },
    },
  );
  return proxy as PeerClient<TApi>;
}

async function callRoute(
  opts: CreatePeerClientOptions,
  methodName: string,
  route: RouteSpec,
  input: unknown,
): Promise<unknown> {
  // 1. zod input validation (optional, opt-in via bodySchema)
  let validated: any = input;
  if (route.bodySchema) {
    const parsed = await route.bodySchema.safeParseAsync(input);
    if (!parsed.success) {
      throw new Error(
        `[xenosis/peers] ${opts.api.name}.${methodName}: input validation failed — ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    validated = parsed.data;
  }

  // 2. resolve path params; remove matched keys from body
  const { url, body } = resolvePath(route, validated);

  // 3. build outbound headers (custom first, then api key, then trace last so it wins)
  const headers: Record<string, string> = { ...(opts.customHeaders ?? {}) };
  if (opts.apiKey) headers['x-xenosis-peer-key'] = opts.apiKey;
  if (opts.callerName) headers[CALLER_HEADER] = opts.callerName;
  const trace = opts.getTraceContext?.();
  if (trace) Object.assign(headers, writeTraceHeaders(trace));

  // 4. determine effective body encoding (binding override > api default > json)
  const bodyEncoding: BodyEncoding =
    opts.bodyEncoding ?? opts.api.bodyEncoding ?? 'json';

  // 5. transport via reliability policy, with optional errorMapper translation.
  // We wrap the call in a start/end timer to feed `xenosis dev` dashboard
  // telemetry (heat-mapped graph). The emit is fire-and-forget and a no-op
  // unless XENOSIS_TELEMETRY_URL is set — see telemetry.ts.
  let result: unknown;
  const startedAt = Date.now();
  let lastStatus: number | null = null;
  let lastError: Error | undefined;
  try {
    result = await opts.policy.execute(() =>
      opts.transport.execute({
        method: route.method,
        url,
        body: route.method === 'GET' ? undefined : body,
        headers,
        bodyEncoding,
      }),
    );
    // We don't have direct access to the HTTP status here (transport returns
    // the parsed body on success). Mark as 200 — anything non-2xx would have
    // thrown PeerHttpError below and we'd capture its `.status`.
    lastStatus = 200;
  } catch (err) {
    lastError = err as Error;
    if (err instanceof PeerHttpError) lastStatus = err.status;
    if (err instanceof PeerHttpError && opts.api.errorMapper) {
      throw opts.api.errorMapper(err.status, err.body);
    }
    throw err;
  } finally {
    // Snapshot bodies for the MCP `explain_trace` consumer. Redact at the
    // source so secrets never reach the dashboard / LLM, then bound the size.
    const reqSnapshot = route.method === 'GET' ? undefined : truncateBody(redactBody(body));
    let respSnapshot: unknown;
    if (lastError instanceof PeerHttpError) {
      respSnapshot = truncateBody(redactBody(lastError.body));
    } else if (lastError === undefined) {
      respSnapshot = truncateBody(redactBody(result));
    }
    emitPeerCallEvent({
      __schema_version: 1,
      kind: 'peer-call',
      from: opts.callerName ?? 'unknown',
      to: opts.api.name,
      method: methodName,
      httpMethod: route.method,
      path: url,
      status: lastStatus,
      durationMs: Date.now() - startedAt,
      ok: lastError === undefined,
      ...(lastError ? { errorName: lastError.name } : {}),
      ...(reqSnapshot !== undefined ? { requestBody: reqSnapshot } : {}),
      ...(respSnapshot !== undefined ? { responseBody: respSnapshot } : {}),
      ...(trace
        ? {
            traceId: trace.traceId,
            spanId: trace.spanId,
            ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
          }
        : {}),
      ts: startedAt,
    });
  }

  // 6. optional response validation
  if (route.responseSchema) {
    const parsed = await route.responseSchema.safeParseAsync(result);
    if (!parsed.success) {
      throw new Error(
        `[xenosis/peers] ${opts.api.name}.${methodName}: response validation failed — ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    return parsed.data;
  }
  return result;
}

/**
 * Replace :param placeholders in the route path with values from input,
 * stripping consumed keys from the body that goes on the wire.
 */
function resolvePath(
  route: RouteSpec,
  input: unknown,
): { url: string; body: unknown } {
  const paramRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const params: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(route.path)) !== null) params.push(m[1]!);

  if (params.length === 0) {
    return { url: appendQueryIfGet(route, input), body: input };
  }

  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  let url = route.path;
  const rest: Record<string, unknown> = { ...obj };

  for (const p of params) {
    const v = obj[p];
    if (v === undefined || v === null) {
      throw new Error(
        `[xenosis/peers] path "${route.path}" requires input field "${p}"`,
      );
    }
    url = url.replace(`:${p}`, encodeURIComponent(String(v)));
    delete rest[p];
  }

  if (route.method === 'GET') {
    return { url: appendQuery(url, rest), body: undefined };
  }
  return { url, body: rest };
}

function appendQueryIfGet(route: RouteSpec, input: unknown): string {
  if (route.method !== 'GET' || !input || typeof input !== 'object') {
    return route.path;
  }
  return appendQuery(route.path, input as Record<string, unknown>);
}

function appendQuery(path: string, query: Record<string, unknown>): string {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of entries) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.set(k, String(v));
  }
  return `${path}?${qs.toString()}`;
}
