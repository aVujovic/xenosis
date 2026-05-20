import type { PeerTransport, TransportRequest } from './types';
import { PeerHttpError } from './reliability';

/**
 * Minimal HTTP transport using global `fetch` (Node 18+).
 *
 * Supports two body encodings:
 *   - 'json'           → application/json (default)
 *   - 'form-urlencoded' → application/x-www-form-urlencoded (Stripe, Twilio…)
 *
 * Throws PeerHttpError on non-2xx; loader-level errorMapper may intercept.
 */
export function createHttpTransport(opts: {
  baseUrl: string;
  peerName: string;
}): PeerTransport {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');

  return {
    async execute<TResponse>(req: TransportRequest): Promise<TResponse> {
      const url = req.url.startsWith('http')
        ? req.url
        : `${baseUrl}${req.url}`;

      const encoding = req.bodyEncoding ?? 'json';
      const headers: Record<string, string> = { ...req.headers };
      const fetchInit: RequestInit = {
        method: req.method,
        headers,
      };

      if (req.body !== undefined && req.method !== 'GET') {
        if (encoding === 'form-urlencoded') {
          if (!hasHeader(headers, 'content-type')) {
            headers['content-type'] = 'application/x-www-form-urlencoded';
          }
          fetchInit.body = encodeForm(req.body);
        } else {
          if (!hasHeader(headers, 'content-type')) {
            headers['content-type'] = 'application/json';
          }
          fetchInit.body = JSON.stringify(req.body);
        }
      }

      const ctl = req.timeoutMs ? new AbortController() : undefined;
      const timer = ctl
        ? setTimeout(() => ctl.abort(), req.timeoutMs)
        : undefined;
      if (ctl) fetchInit.signal = ctl.signal;

      let res: Response;
      try {
        res = await fetch(url, fetchInit);
      } finally {
        if (timer) clearTimeout(timer);
      }

      const text = await res.text();
      const parsed = text ? safeParse(text) : undefined;

      if (!res.ok) {
        throw new PeerHttpError(
          res.status,
          opts.peerName,
          req.method,
          url,
          parsed ?? text,
        );
      }

      return parsed as TResponse;
    },
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/**
 * Encode an object as application/x-www-form-urlencoded.
 * Nested objects use Stripe-style bracket notation (`metadata[order]=123`),
 * arrays use `tags[]=a&tags[]=b`.
 */
function encodeForm(body: unknown): string {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  const params = new URLSearchParams();
  appendForm(params, '', body as Record<string, unknown>);
  return params.toString();
}

function appendForm(
  params: URLSearchParams,
  prefix: string,
  obj: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null) {
          params.append(`${key}[]`, String(item));
        }
      }
    } else if (typeof v === 'object') {
      appendForm(params, key, v as Record<string, unknown>);
    } else {
      params.append(key, String(v));
    }
  }
}
