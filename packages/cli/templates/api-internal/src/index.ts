import { definePeerApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * Shared API contract for the {{nameKebab}}-service.
 * Both provider and consumers import this package so the routes + types are a
 * single source of truth.
 */
export interface {{ApiPascal}} {
  ping(input: { message: string }): Promise<{ echoed: string; at: string }>;
}

const pingSchema = z.object({
  message: z.string().min(1),
});

export const {{apiCamel}} = definePeerApi<{{ApiPascal}}>({
  name: '{{nameKebab}}',
  routes: {
    ping: {
      method: 'POST',
      path: '/api/v1/{{nameKebab}}/ping',
      bodySchema: pingSchema,
    },
  },
});

export default {{apiCamel}};
