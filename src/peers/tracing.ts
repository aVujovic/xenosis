import { randomUUID } from 'node:crypto';
import type { TraceContext } from './types';

export const TRACE_HEADER = 'x-xenosis-trace-id';
export const SPAN_HEADER = 'x-xenosis-span-id';
export const PARENT_SPAN_HEADER = 'x-xenosis-parent-span-id';

/** Identifies the calling Xenosis service. Used for inbound boundary checks. */
export const CALLER_HEADER = 'x-xenosis-caller';

/**
 * Build a fresh trace context (no inbound parent).
 * Used for synthetic requests and bootstrap traces.
 */
export function newTrace(): TraceContext {
  return {
    traceId: randomUUID(),
    spanId: randomUUID(),
  };
}

/**
 * Derive a child span under an existing trace.
 * Used when a peer call originates from an incoming request that already
 * carries trace headers.
 */
export function childSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: randomUUID(),
    parentSpanId: parent.spanId,
  };
}

/**
 * Read trace headers from an Express request (or any header bag).
 * Returns null if no trace ID is present.
 */
export function readTraceFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): TraceContext | null {
  const traceId = pickHeader(headers[TRACE_HEADER]);
  if (!traceId) return null;
  const spanId = pickHeader(headers[SPAN_HEADER]) ?? randomUUID();
  const parentSpanId = pickHeader(headers[PARENT_SPAN_HEADER]);
  return parentSpanId ? { traceId, spanId, parentSpanId } : { traceId, spanId };
}

/**
 * Encode a trace context into an outbound HTTP header bag.
 */
export function writeTraceHeaders(
  ctx: TraceContext,
): Record<string, string> {
  const headers: Record<string, string> = {
    [TRACE_HEADER]: ctx.traceId,
    [SPAN_HEADER]: ctx.spanId,
  };
  if (ctx.parentSpanId) {
    headers[PARENT_SPAN_HEADER] = ctx.parentSpanId;
  }
  return headers;
}

function pickHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
