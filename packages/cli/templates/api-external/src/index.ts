import { definePeerApi, Exception } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * Wrapper for the external {{nameKebab}} API.
 *
 * External APIs live in `apis/xenosis-custom/` and own:
 *   - `external: true` flag
 *   - custom `bodyEncoding` (often 'form-urlencoded' for SaaS APIs)
 *   - `errorMapper` to translate vendor errors into Xenosis Exceptions
 *
 * Auth (e.g. Authorization: Bearer …) is supplied per-environment via the
 * consumer's `peers.{{nameCamel}}.headers` config block.
 */
export interface {{ApiPascal}} {
  // TODO: replace with real methods of the upstream API.
  ping(input: { message: string }): Promise<unknown>;
}

const pingSchema = z.object({
  message: z.string().min(1),
});

export const {{apiCamel}} = definePeerApi<{{ApiPascal}}>({
  name: '{{nameKebab}}',
  external: true,
  // bodyEncoding: 'form-urlencoded',   // enable if the upstream takes form bodies
  errorMapper: (status, body) => {
    if (status === 401) return Exception.Unauthorized(body);
    if (status === 403) return Exception.Forbidden(body);
    if (status === 404) return Exception.NotFound(body);
    if (status === 429) return Exception.TooManyRequests(body);
    if (status >= 500) return Exception.BadGateway(body);
    return Exception.BadRequest(body);
  },
  routes: {
    ping: {
      method: 'POST',
      path: '/ping',
      bodySchema: pingSchema,
    },
  },
});

export default {{apiCamel}};
