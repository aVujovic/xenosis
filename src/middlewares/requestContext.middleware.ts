import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { asValue, type AwilixContainer } from 'awilix';
import type { ILogger } from '../types';
import type { XenosisConfig } from '../config.schema';
import type { TraceContext } from '../peers/types';
import {
  readTraceFromHeaders,
  newTrace,
  writeTraceHeaders,
  CALLER_HEADER,
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
      /**
       * True when this request was sent by the `xenosis dev` dashboard's
       * Time-Travel Replay against a recorded trace, rather than by a real
       * client. Controllers should check `req.isReplay` and skip irreversible
       * side-effects (DB writes, external API calls, email sends, payment
       * captures). Sourced from the `x-xenosis-replay: true` header — see
       * REPLAY_HEADER.
       */
      isReplay?: boolean;
    }
  }
}

/** Request header that flags a Time-Travel Replay invocation. */
export const REPLAY_HEADER = 'x-xenosis-replay';

type RequestLogMode = 'start' | 'end' | 'both' | 'off';

function asMode(v: unknown): RequestLogMode {
  if (v === 'start' || v === 'end' || v === 'both' || v === 'off') return v;
  return 'end';
}

/**
 * Decide whether an inbound request is allowed by the service's boundaries.
 *
 * The check only applies to peer-to-peer traffic — requests carrying the
 * `x-xenosis-caller` header. Browser / public requests (no header) always pass,
 * and a service without `allowedCallers` accepts every caller (default open).
 */
export function isCallerAllowed(
  caller: string | undefined,
  allowedCallers: string[] | undefined,
): boolean {
  if (!allowedCallers || allowedCallers.length === 0) return true;
  if (!caller) return true;
  return allowedCallers.includes(caller);
}

/**
 * Pull the auth token from a request, accepting any of:
 *   - `Authorization: Bearer <token>`
 *   - `x-auth-token: <token>`
 *   - `?authToken=<token>`
 * Returns undefined when none is present.
 */
export function extractToken(req: Request): string | undefined {
  const authz = req.header('authorization');
  if (authz) {
    const m = /^Bearer\s+(.+)$/i.exec(authz);
    if (m) return m[1]!.trim();
  }
  const headerToken = req.header('x-auth-token');
  if (headerToken) return headerToken.trim();
  const q = req.query?.authToken;
  if (typeof q === 'string' && q) return q;
  return undefined;
}

/**
 * Whether a path bypasses the auth gate. `/healthcheck` (and sub-paths) is
 * always exempt so liveness probes work without a token; `exempt` adds extra
 * bypass prefixes from config (e.g. OpenAPI spec + Swagger UI).
 */
export function isAuthExempt(path: string, exempt: string[] | undefined): boolean {
  if (path === '/healthcheck' || path.startsWith('/healthcheck/')) return true;
  if (!exempt) return false;
  return exempt.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
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
  config: Pick<XenosisConfig, 'requestLog' | 'boundaries' | 'authentication'> = {},
): RequestHandler {
  const mode = asMode(config.requestLog);
  const allowedCallers = config.boundaries?.allowedCallers;
  const auth = config.authentication;
  const authEnabled = auth?.enabled === true;

  return (req: Request, res: Response, next: NextFunction) => {
    // Boundary check: reject peer calls from services not in allowedCallers.
    // Only peer traffic (carrying x-xenosis-caller) is subject to this.
    const caller = req.header(CALLER_HEADER);
    if (!isCallerAllowed(caller, allowedCallers)) {
      rootLogger.warn(
        { caller, path: req.path, method: req.method },
        `request:forbidden — caller "${caller}" not in boundaries.allowedCallers`,
      );
      res.status(403).json({
        error: 'Forbidden',
        message: `caller "${caller}" is not permitted to call this service`,
      });
      return;
    }

    // Auth gate: when enabled, every non-exempt request must present the
    // configured shared token (header or ?authToken). /healthcheck is always
    // exempt; config.authentication.exempt adds more bypass prefixes.
    if (authEnabled && !isAuthExempt(req.path, auth!.exempt)) {
      const token = extractToken(req);
      if (!token || token !== auth!.token) {
        rootLogger.warn(
          { path: req.path, method: req.method },
          'request:unauthorized — missing or invalid auth token',
        );
        res.status(401).json({
          error: 'Unauthorized',
          message: 'missing or invalid authentication token',
        });
        return;
      }
    }

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
    // Replay flag from the dev dashboard — controllers should consult this
    // to skip irreversible side-effects when running against a recorded payload.
    req.isReplay = req.header(REPLAY_HEADER)?.toLowerCase() === 'true';

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
