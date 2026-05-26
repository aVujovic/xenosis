/**
 * Peer-call telemetry — fire-and-forget event stream consumed by the
 * `xenosis dev` dashboard for the heat-mapped peer graph (volume, p95
 * latency, circuit-breaker / retry signals).
 *
 * Design choices:
 *   • Opt-in via env (XENOSIS_TELEMETRY_URL). When unset, every helper here
 *     is a zero-cost no-op — safe to leave in production builds.
 *   • Fire-and-forget: telemetry **must not** affect peer-call latency or
 *     reliability. Errors are silently swallowed.
 *   • Bounded outbound time: a hard AbortController timeout (TELEMETRY_TIMEOUT_MS)
 *     ensures a slow/dead collector never piles up pending promises.
 *
 * The dashboard's collector is at POST /api/telemetry on the `xenosis dev`
 * UI port (default 9000); the CLI injects XENOSIS_TELEMETRY_URL into every
 * service it spawns.
 */

const TELEMETRY_TIMEOUT_MS = 500;

/** One peer call as the dashboard sees it. */
export interface PeerCallEvent {
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
  /** Trace correlation, when available. */
  traceId?: string;
  spanId?: string;
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
