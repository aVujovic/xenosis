import { definePeerApi, Exception } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * Wrapper for httpbin.org — a free public API that echoes back the request.
 * Useful as an "external API" smoke test because we can verify:
 *   1. custom headers are sent verbatim (Authorization Bearer …)
 *   2. form-urlencoded encoding works (Stripe-style APIs)
 *   3. errorMapper converts vendor errors into Xenosis Exceptions
 */

export interface HttpBinResponse {
  args: Record<string, string>;
  form?: Record<string, string>;
  json?: unknown;
  headers: Record<string, string>;
  url: string;
}

export type HttpBinApi = {
  /** GET /get — echoes back query params + headers. */
  echoGet(input: { foo?: string; bar?: string }): Promise<HttpBinResponse>;

  /** POST /post — echoes back form body + headers (form-urlencoded). */
  echoPost(input: { amount: number; currency: string; note?: string }): Promise<HttpBinResponse>;

  /** GET /status/:code — returns the given status code; tests errorMapper. */
  echoStatus(input: { code: number }): Promise<HttpBinResponse>;
};

export const httpbinApi = definePeerApi<HttpBinApi>({
  name: 'httpbin',
  external: true,
  bodyEncoding: 'form-urlencoded',
  errorMapper: (status, body) => {
    if (status === 401) return Exception.Unauthorized(body);
    if (status === 402) return Exception.PaymentRequired(body);
    if (status === 403) return Exception.Forbidden(body);
    if (status === 404) return Exception.NotFound(body);
    if (status === 418) return Exception.ImATeapot(body);
    if (status >= 500) return Exception.BadGateway(body);
    return Exception.BadRequest(body);
  },
  routes: {
    echoGet: {
      method: 'GET',
      path: '/get',
      bodySchema: z.object({
        foo: z.string().optional(),
        bar: z.string().optional(),
      }),
    },
    echoPost: {
      method: 'POST',
      path: '/post',
      bodySchema: z.object({
        amount: z.number().int().positive(),
        currency: z.string().length(3),
        note: z.string().optional(),
      }),
    },
    echoStatus: {
      method: 'GET',
      path: '/status/:code',
      bodySchema: z.object({
        code: z.number().int().min(100).max(599),
      }),
    },
  },
});

export default httpbinApi;
