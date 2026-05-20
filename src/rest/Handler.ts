import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express';
import { Response as CoreResponse } from './Response';

export type Selector<T = unknown> = (
  req: ExpressRequest,
  res: ExpressResponse,
) => T | Promise<T>;

type HandlerFn<SArgs extends readonly unknown[]> = (
  ...args: [...SArgs, ExpressRequest, ExpressResponse, NextFunction]
) => CoreResponse | Promise<CoreResponse>;

type BuiltHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

/**
 * Builds an Express-style request handler from selectors (req,res -> data)
 * plus a final handler that gets all selector results + (req, res, next)
 * and must return a Response instance.
 *
 * Overloads are listed by arity (0..6 selectors) because TS variadic-tuple
 * inference loses precision when the trailing handler has a different shape
 * than the variadic selectors. Each overload fixes selector arity so TS can
 * infer each selector's return type and feed it positionally into the
 * handler — that's what gives you `(body, user, tenant) => ...` typing.
 */
export function Handler(handler: HandlerFn<[]>): BuiltHandler;
export function Handler<A>(
  a: Selector<A>,
  handler: HandlerFn<[A]>,
): BuiltHandler;
export function Handler<A, B>(
  a: Selector<A>,
  b: Selector<B>,
  handler: HandlerFn<[A, B]>,
): BuiltHandler;
export function Handler<A, B, C>(
  a: Selector<A>,
  b: Selector<B>,
  c: Selector<C>,
  handler: HandlerFn<[A, B, C]>,
): BuiltHandler;
export function Handler<A, B, C, D>(
  a: Selector<A>,
  b: Selector<B>,
  c: Selector<C>,
  d: Selector<D>,
  handler: HandlerFn<[A, B, C, D]>,
): BuiltHandler;
export function Handler<A, B, C, D, E>(
  a: Selector<A>,
  b: Selector<B>,
  c: Selector<C>,
  d: Selector<D>,
  e: Selector<E>,
  handler: HandlerFn<[A, B, C, D, E]>,
): BuiltHandler;
export function Handler<A, B, C, D, E, F>(
  a: Selector<A>,
  b: Selector<B>,
  c: Selector<C>,
  d: Selector<D>,
  e: Selector<E>,
  f: Selector<F>,
  handler: HandlerFn<[A, B, C, D, E, F]>,
): BuiltHandler;
export function Handler(...selectorsAndHandler: unknown[]): BuiltHandler {
  const selectors = selectorsAndHandler.slice(
    0,
    -1,
  ) as readonly Selector<unknown>[];
  const handler = selectorsAndHandler[
    selectorsAndHandler.length - 1
  ] as (
    ...args: unknown[]
  ) => CoreResponse | Promise<CoreResponse>;

  return async (req, res, next): Promise<void> => {
    try {
      const args: unknown[] = [];

      for (let i = 0; i < selectors.length; ++i) {
        const selector = selectors[i];

        if (typeof selector !== 'function') {
          throw new Error(`@xenosisorg/xenosis-core/Handler: arg[${i}] is not a function!`);
        }

        args.push(await selector(req, res));
      }

      const response = await handler(...args, req, res, next);

      if (!(response instanceof CoreResponse)) {
        throw new Error(
          '@xenosisorg/xenosis-core/Handler: did not receive @xenosisorg/xenosis-core/Response',
        );
      }

      response.apply(res);
    } catch (err) {
      next(err as Error);
    }
  };
}
