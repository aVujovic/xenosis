import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { asValue, type AwilixContainer } from 'awilix';
import type { ILogger } from '../types';
import type { TraceContext } from '../peers/types';
import {
  readTraceFromHeaders,
  newTrace,
  writeTraceHeaders,
} from '../peers/tracing';

/**
 * Per-request bag flowing through AsyncLocalStorage. Anything that runs inside
 * a request handler (peer clients, service methods, awaited DB calls) can pull
 * it via `getRequestContext()` without explicit passing.
 */
export interface RequestContext {
  trace: TraceContext;
  scope: AwilixContainer;
  /** Child of the root logger, bound to `{ traceId, method, path, ... }`. */
  logger: ILogger;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Returns the active request context (or undefined when outside a request). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Returns the active trace context (or undefined when outside a request). */
export function getActiveTraceContext(): TraceContext | undefined {
  return storage.getStore()?.trace;
}

/** Augment Express types so `req.scope` and `req.traceContext` are typed. */
declare global {
  namespace Express {
    interface Request {
      scope?: AwilixContainer;
      traceContext?: TraceContext;
      requestLogger?: ILogger;
      requestStartedAt?: number;
    }
  }
}

type RequestLogMode = 'start' | 'end' | 'both' | 'off';

function asMode(v: unknown): RequestLogMode {
  if (v === 'start' || v === 'end' || v === 'both' || v === 'off') return v;
  return 'end';
}

/**
 * Builds the per-request middleware that:
 *   1. reads inbound x-xenosis-trace-* headers (or mints a fresh trace)
 *   2. creates an awilix request scope with `traceContext` and `requestLogger`
 *      cradle keys bound to this request
 *   3. attaches the scope to `req.scope` and the trace to `req.traceContext`
 *   4. echoes the trace headers on the response
 *   5. logs the request based on `config.requestLog` (start | end | both | off)
 *   6. wraps the whole `next()` chain in AsyncLocalStorage so deep async code
 *      can resolve the active trace without prop-drilling
 */
export function buildRequestContextMiddleware(
  container: AwilixContainer,
  rootLogger: ILogger,
  config: { requestLog?: string } = {},
): RequestHandler {
  const mode = asMode(config.requestLog);

  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = readTraceFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const trace: TraceContext = inbound ?? newTrace();

    const reqLogger = rootLogger.child({
      traceId: trace.traceId,
      spanId: trace.spanId,
      ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
      method: req.method,
      path: req.path,
    });

    const scope = container.createScope();
    scope.register({
      traceContext: asValue(trace),
      requestLogger: asValue(reqLogger),
    });

    req.scope = scope;
    req.traceContext = trace;
    req.requestLogger = reqLogger;
    req.requestStartedAt = Date.now();

    // Echo trace headers back so the caller can correlate.
    const outboundHeaders = writeTraceHeaders(trace);
    for (const [k, v] of Object.entries(outboundHeaders)) res.setHeader(k, v);

    if (mode === 'start' || mode === 'both') {
      reqLogger.info('request:start');
    }

    if (mode === 'end' || mode === 'both') {
      res.on('finish', () => {
        const duration = Date.now() - (req.requestStartedAt ?? Date.now());
        reqLogger.info(
          { status: res.statusCode, durationMs: duration },
          'request:end',
        );
      });
    }

    storage.run({ trace, scope, logger: reqLogger }, () => next());
  };
}
