import type { Request as ExpressRequest } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { Exception } from './Exception.js';

type RequestProperty = 'query' | 'body' | 'headers' | 'params';

const validate =
  <K extends RequestProperty>(property: K) =>
  <Schema extends ZodTypeAny>(schema: Schema) =>
  async (req: ExpressRequest): Promise<z.output<Schema>> => {
    const result = await schema.safeParseAsync(req[property]);
    if (!result.success) {
      throw Exception.BadRequest(
        result.error.issues.map(({ message, path }) => ({ message, path })),
      );
    }
    return result.data;
  };

export class Request {
  static Query = validate('query');
  static Body = validate('body');
  static Headers = validate('headers');
  static Params = validate('params');
}

export { z };
