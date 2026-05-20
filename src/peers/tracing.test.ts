import { describe, it, expect } from 'vitest';
import {
  newTrace,
  childSpan,
  readTraceFromHeaders,
  writeTraceHeaders,
  TRACE_HEADER,
  SPAN_HEADER,
  PARENT_SPAN_HEADER,
} from './tracing';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('tracing', () => {
  describe('newTrace', () => {
    it('returns fresh UUID traceId + spanId, no parent', () => {
      const t = newTrace();
      expect(t.traceId).toMatch(UUID);
      expect(t.spanId).toMatch(UUID);
      expect(t.parentSpanId).toBeUndefined();
    });

    it('produces a different trace each call', () => {
      expect(newTrace().traceId).not.toBe(newTrace().traceId);
    });
  });

  describe('childSpan', () => {
    it('keeps the traceId, new spanId, parent = old span', () => {
      const parent = newTrace();
      const child = childSpan(parent);
      expect(child.traceId).toBe(parent.traceId);
      expect(child.spanId).not.toBe(parent.spanId);
      expect(child.parentSpanId).toBe(parent.spanId);
    });
  });

  describe('readTraceFromHeaders', () => {
    it('returns null when no trace id header', () => {
      expect(readTraceFromHeaders({})).toBeNull();
    });

    it('reads trace/span/parent from headers', () => {
      const ctx = readTraceFromHeaders({
        [TRACE_HEADER]: 't1',
        [SPAN_HEADER]: 's1',
        [PARENT_SPAN_HEADER]: 'p1',
      });
      expect(ctx).toEqual({ traceId: 't1', spanId: 's1', parentSpanId: 'p1' });
    });

    it('mints a spanId when only trace id is present', () => {
      const ctx = readTraceFromHeaders({ [TRACE_HEADER]: 't1' });
      expect(ctx?.traceId).toBe('t1');
      expect(ctx?.spanId).toMatch(UUID);
      expect(ctx?.parentSpanId).toBeUndefined();
    });

    it('takes the first value when a header is an array', () => {
      const ctx = readTraceFromHeaders({ [TRACE_HEADER]: ['ta', 'tb'] });
      expect(ctx?.traceId).toBe('ta');
    });
  });

  describe('writeTraceHeaders', () => {
    it('encodes trace + span', () => {
      const h = writeTraceHeaders({ traceId: 't', spanId: 's' });
      expect(h[TRACE_HEADER]).toBe('t');
      expect(h[SPAN_HEADER]).toBe('s');
      expect(h[PARENT_SPAN_HEADER]).toBeUndefined();
    });

    it('includes parent span when present', () => {
      const h = writeTraceHeaders({ traceId: 't', spanId: 's', parentSpanId: 'p' });
      expect(h[PARENT_SPAN_HEADER]).toBe('p');
    });
  });

  it('round-trips: write then read yields the same context', () => {
    const original = childSpan(newTrace());
    const restored = readTraceFromHeaders(writeTraceHeaders(original));
    expect(restored).toEqual(original);
  });
});
