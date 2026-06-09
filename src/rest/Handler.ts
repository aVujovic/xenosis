import type { ZodTypeAny } from 'zod';
import { Response as CoreResponse } from './Response';
import { SELECTOR_META, type SelectorMeta } from './Request';
import type { XReq, XRes, XNext } from './http';

export type Selector<T = unknown> = (
  req: XReq,
  res: XRes,
) => T | Promise<T>;

/**
 * The user's handler receives the selector results followed by an optional
 * trio of (XReq, XRes, XNext). Most controllers only destructure the selector
 * results and never declare the trio — TS sees those three as optional. The
 * runtime always passes all three positionally; if the user's function ignores
 * them, JS just drops the extras.
 */
type HandlerFn<SArgs extends readonly unknown[]> = (
  ...args: [...SArgs, XReq?, XRes?, XNext?]
) => CoreResponse | Promise<CoreResponse>;

/**
 * Route metadata harvested from the selectors plus an optional response schema
 * declared with `.returns(schema)`. The recording Router reads this off the
 * built handler to assemble the OpenAPI document.
 */
export interface RouteMeta {
  request: SelectorMeta[];
  response?: ZodTypeAny;
}

export const ROUTE_META = Symbol.for('xenosis.routeMeta');

export interface BuiltHandler {
  (req: XReq, res: XRes, next: XNext): Promise<void>;
  [ROUTE_META]: RouteMeta;
  /** Declare the success (200) response schema for OpenAPI. Chainable. */
  returns(schema: ZodTypeAny): BuiltHandler;
}

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

  const built = (async (req, res, next): Promise<void> => {
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
  }) as BuiltHandler;

  // Recover each selector's schema (stamped by Request.*) so OpenAPI can
  // document the request. Selectors without metadata (custom resolvers like
  // resolveTenant) are simply skipped.
  const request: SelectorMeta[] = [];
  for (const selector of selectors) {
    const meta = (selector as { [SELECTOR_META]?: SelectorMeta })[SELECTOR_META];
    if (meta) request.push(meta);
  }

  built[ROUTE_META] = { request };
  built.returns = (schema: ZodTypeAny): BuiltHandler => {
    built[ROUTE_META].response = schema;
    return built;
  };

  return built;
}
