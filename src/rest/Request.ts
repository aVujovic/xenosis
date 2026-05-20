import type { Request as ExpressRequest } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { Exception } from './Exception.js';

type RequestProperty = 'query' | 'body' | 'headers' | 'params';

/**
 * Metadata stamped onto each selector so the OpenAPI generator can recover the
 * zod schema (which would otherwise be trapped inside the validator closure).
 * Selectors stay plain `(req) => data` functions — Express ignores the extra
 * property, and the runtime behaviour is unchanged.
 */
export interface SelectorMeta {
  in: RequestProperty;
  schema: ZodTypeAny;
}

export const SELECTOR_META = Symbol.for('xenosis.selectorMeta');

const validate =
  <K extends RequestProperty>(property: K) =>
  <Schema extends ZodTypeAny>(schema: Schema) => {
    const selector = async (req: ExpressRequest): Promise<z.output<Schema>> => {
      const result = await schema.safeParseAsync(req[property]);
      if (!result.success) {
        throw Exception.BadRequest(
          result.error.issues.map(({ message, path }) => ({ message, path })),
        );
      }
      return result.data;
    };
    (selector as { [SELECTOR_META]?: SelectorMeta })[SELECTOR_META] = {
      in: property,
      schema,
    };
    return selector;
  };

export class Request {
  static Query = validate('query');
  static Body = validate('body');
  static Headers = validate('headers');
  static Params = validate('params');
}

export { z };
