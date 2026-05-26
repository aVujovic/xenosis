/**
 * Shared helpers: secret redaction (anything we surface back to the AI), and a
 * `fetch` wrapper with hard timeout so a hung service can't hang the MCP server.
 */

const SECRET_KEY_PATTERN = /(token|secret|password|apikey|api_key|jwtsecret)$/i;

/**
 * Deep-clone `value` and replace any property whose key looks secret with
 * '<redacted>'. Also masks credentials embedded in URL strings (postgresql://user:pw@host → user:<redacted>@host).
 *
 * Conservative on purpose: we'd rather over-redact than ever surface a real
 * token to the LLM context.
 */
export function redact<T>(value: T): T {
  return redactInternal(value) as T;
}

function redactInternal(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return maskUrlCreds(value);
  if (Array.isArray(value)) return value.map(redactInternal);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k) && v && typeof v === 'string' && v.length > 0) {
        out[k] = '<redacted>';
      } else {
        out[k] = redactInternal(v);
      }
    }
    return out;
  }
  return value;
}

function maskUrlCreds(s: string): string {
  // postgresql://user:pw@host:5432/db → postgresql://user:<redacted>@host:5432/db
  return s.replace(/(\w+:\/\/[^:\/\s]+:)([^@\s]+)(@)/g, '$1<redacted>$3');
}

/** fetch() with an AbortController-backed timeout. Default 2s. */
export async function fetchWithTimeout(
  url: string,
  ms = 2000,
  init?: RequestInit,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Build a uniform tool-error reply. */
export function errorReply(message: string): {
  isError: true;
  content: { type: 'text'; text: string }[];
} {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Build a uniform success reply with JSON-stringified data. */
export function jsonReply(data: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
