/**
 * Peer-call telemetry — fire-and-forget event stream consumed by the
 * `xenosis dev` dashboard. Two consumers today:
 *   • Heat-mapped peer graph (volume, p95 latency, breaker / retry signals).
 *   • Per-trace correlation store (`explain_trace` MCP tool) — full
 *     request/response bodies for one trace id, redacted at the source.
 *
 * Design choices:
 *   • Opt-in via env (XENOSIS_TELEMETRY_URL). When unset, every helper here
 *     is a zero-cost no-op — safe to leave in production builds.
 *   • Fire-and-forget: telemetry **must not** affect peer-call latency or
 *     reliability. Errors are silently swallowed.
 *   • Bounded outbound time: a hard AbortController timeout (TELEMETRY_TIMEOUT_MS)
 *     ensures a slow/dead collector never piles up pending promises.
 *   • Redaction at the source: any field that looks like a secret is masked
 *     before the body leaves the service. The dashboard / MCP / LLM never
 *     see real tokens.
 *   • Bounded body size — we truncate after BODY_MAX_BYTES so a runaway
 *     payload can't pin telemetry forever.
 *
 * The dashboard's collector is at POST /api/telemetry on the `xenosis dev`
 * UI port (default 9000); the CLI injects XENOSIS_TELEMETRY_URL into every
 * service it spawns.
 *
 * Schema versioning: the `__schema_version` field carries the wire-protocol
 * version so a future OpenTelemetry-spec emitter (v0.6 roadmap) can publish
 * a parallel `__schema_version: 2` stream without breaking existing
 * dashboards.
 */

const TELEMETRY_TIMEOUT_MS = 500;
const BODY_MAX_BYTES = 8 * 1024; // 8KB per body — enough for typical peer payloads, not so much we ship multi-MB blobs
const SECRET_KEY = /(token|secret|password|api[_-]?key|jwt[_-]?secret|authorization)/i;

/** Current wire-protocol version. Bumped when fields change shape. */
export const PEER_TELEMETRY_SCHEMA_VERSION = 1;

/** One peer call as the dashboard sees it. */
export interface PeerCallEvent {
  /** Schema version of this payload. Consumers fall back gracefully on mismatch. */
  __schema_version: 1;
  /** Always 'peer-call' — placeholder for future event kinds. */
  kind: 'peer-call';
  /** Source service name (config.peerName ?? config.name). */
  from: string;
  /** Target peer cradle key (e.g. 'billing'). */
  to: string;
  /** Method on the peer client (the RouteSpec key). */
  method: string;
  /** HTTP method of the underlying route. */
  httpMethod: string;
  /** Resolved request path (with :param substituted). */
  path: string;
  /** Final HTTP status, or null if the call failed before any response (timeout, refused, breaker open). */
  status: number | null;
  /** Wall-clock duration in ms from the call entering the reliability policy to it returning/throwing. */
  durationMs: number;
  /** True if the call returned without a thrown exception (regardless of HTTP status). */
  ok: boolean;
  /** Error class name on failure, useful for breaker / retry detection on the dashboard side. */
  errorName?: string;
  /** Redacted, possibly-truncated request body — what was sent to the peer. */
  requestBody?: unknown;
  /** Redacted, possibly-truncated response body — what the peer replied (or the PeerHttpError body on failure). */
  responseBody?: unknown;
  /** Trace correlation, when available. */
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  /** Unix ms when the event was constructed. */
  ts: number;
}

/**
 * Send a single event to the configured collector. Resolves immediately —
 * the request is dispatched in the background. Never throws.
 */
export function emitPeerCallEvent(event: PeerCallEvent): void {
  const url = process.env.XENOSIS_TELEMETRY_URL;
  if (!url) return;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TELEMETRY_TIMEOUT_MS);

  // We deliberately do NOT await the fetch. The caller path stays unblocked.
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: ac.signal,
  })
    .catch(() => {
      /* swallow — telemetry must never affect the app */
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Deep-redact secret-looking fields and mask URL credentials. Same rules
 * as the MCP server's `get_service_config` redactor — kept in sync because
 * AI assistants consume both surfaces.
 */
export function redactBody<T>(value: T): T {
  return redactInternal(value) as T;
}

function redactInternal(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return maskUrlCreds(v);
  if (Array.isArray(v)) return v.map(redactInternal);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEY.test(k) && val && typeof val === 'string' && val.length > 0) {
        out[k] = '<redacted>';
      } else {
        out[k] = redactInternal(val);
      }
    }
    return out;
  }
  return v;
}

function maskUrlCreds(s: string): string {
  // postgresql://user:pw@host → postgresql://user:<redacted>@host
  return s.replace(/(\w+:\/\/[^:/\s]+:)([^@\s]+)(@)/g, '$1<redacted>$3');
}

/**
 * Truncate a JSON-serialisable body so a single telemetry event never
 * exceeds BODY_MAX_BYTES. Returns the value as-is when it's safely small,
 * otherwise a marker object that signals the dashboard it was clipped.
 */
export function truncateBody(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return undefined;
    if (json.length <= BODY_MAX_BYTES) return value;
    return {
      __truncated: true,
      bytes: json.length,
      preview: json.slice(0, BODY_MAX_BYTES),
    };
  } catch {
    // Non-serialisable (circular ref, BigInt, etc.) — drop rather than poison the pipe.
    return { __unserialisable: true };
  }
}
