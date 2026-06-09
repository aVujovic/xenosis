/**
 * Framework-agnostic HTTP types.
 *
 * These describe the request / response / handler shapes the Xenosis REST layer
 * operates on, independent of the underlying web framework. The shipped Express
 * adapter passes its native `Request`/`Response` through unchanged — they
 * already implement this shape structurally. The Hono adapter (Phase 3) maps
 * Hono's `Context` onto these interfaces with a small glue layer.
 *
 * User code (controllers, middleware, peer handlers) should import and use
 * these types instead of importing from `express` directly.
 */
import type { AwilixContainer } from 'awilix';
import type { Server as HttpServer } from 'node:http';
import type { ILogger } from '../types';
import type { TraceContext } from '../peers/types';

/**
 * Per-request context fields populated by the request-context middleware. They
 * appear directly on the request object so middleware that already has the
 * request handle can read them without a separate lookup. They are optional
 * because middleware ordering can place a consumer before the populator.
 */
export interface XRequestContext {
  scope?: AwilixContainer;
  traceContext?: TraceContext;
  requestLogger?: ILogger;
  requestStartedAt?: number;
  isReplay?: boolean;
}

/**
 * Framework-agnostic request. Structurally compatible with Express's `Request`
 * for the subset we use, so the Express adapter does not wrap; the Hono adapter
 * builds one from Hono's `Context`.
 */
export interface XReq extends XRequestContext {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  params: Record<string, string>;
  body: unknown;
  /** Returns the first value of the named header (case-insensitive). */
  header(name: string): string | undefined;
  /** Escape hatch — the underlying framework request (Express `Request`, Hono `Context`, …). */
  raw?: unknown;
}

/**
 * Framework-agnostic response. The subset we use is the intersection of Express
 * and what a Hono adapter can implement on top of `Context`. The recording
 * router and `Response.apply()` call into these methods only.
 */
export interface XRes {
  statusCode: number;
  headersSent: boolean;
  status(code: number): XRes;
  setHeader(name: string, value: string | number | readonly string[]): XRes;
  getHeader(name: string): string | number | string[] | undefined;
  json(body: unknown): XRes;
  send(body?: unknown): XRes;
  end(body?: unknown): XRes;
  on(event: 'finish' | 'close', listener: () => void): XRes;
  /** Escape hatch — the underlying framework response object. */
  raw?: unknown;
}

export type XNext = (err?: unknown) => void;

/**
 * Generic HTTP middleware. The return type is `unknown` rather than
 * `void | Promise<void>` because Express's `RequestHandler` returns `any` —
 * any handler that compiles under Express's types should also compile here,
 * including ones that return a value the framework ignores.
 */
export type XHandler = (req: XReq, res: XRes, next: XNext) => unknown;

export type XErrorHandler = (
  err: unknown,
  req: XReq,
  res: XRes,
  next: XNext,
) => unknown;

/**
 * The verb subset of an Express-style router. Both `app.get(path, h)` and
 * `router.route(path).get(h)` are supported because they're idiomatic across the
 * existing codebase; the recording router (src/rest/openapi.ts) hooks into
 * `.route()` to capture both forms.
 */
export interface XRouterRoute {
  get(...handlers: XHandler[]): XRouterRoute;
  post(...handlers: XHandler[]): XRouterRoute;
  put(...handlers: XHandler[]): XRouterRoute;
  patch(...handlers: XHandler[]): XRouterRoute;
  delete(...handlers: XHandler[]): XRouterRoute;
  options(...handlers: XHandler[]): XRouterRoute;
  head(...handlers: XHandler[]): XRouterRoute;
}

export interface XRouter {
  get(path: string, ...handlers: XHandler[]): XRouter;
  post(path: string, ...handlers: XHandler[]): XRouter;
  put(path: string, ...handlers: XHandler[]): XRouter;
  patch(path: string, ...handlers: XHandler[]): XRouter;
  delete(path: string, ...handlers: XHandler[]): XRouter;
  options(path: string, ...handlers: XHandler[]): XRouter;
  head(path: string, ...handlers: XHandler[]): XRouter;
  all(path: string, ...handlers: XHandler[]): XRouter;
  /**
   * Mount middleware or a sub-router. Two forms:
   *   server.use(mw, mw2, ...)             — global middleware
   *   server.use('/prefix', router, ...)   — mount sub-router at prefix
   * The first argument may also be another `XRouter` (treated as middleware on
   * Express; mounted as a sub-app on Hono).
   */
  use(path: string, ...handlers: (XHandler | XRouter)[]): XRouter;
  use(...handlers: (XHandler | XRouter)[]): XRouter;
  route(path: string): XRouterRoute;
}

/**
 * Symbol attached to `XServer` instances pointing at the underlying Node HTTP
 * server. The sockets loader pulls this to attach an `upgrade` handler — works
 * the same across Express and Hono adapters because both expose a node:http
 * server underneath.
 */
export const HTTP_SERVER = Symbol.for('xenosis.httpServer');

export interface XServer extends XRouter {
  listen(port: number, callback?: () => void): unknown;
  [HTTP_SERVER]?: HttpServer;
}
