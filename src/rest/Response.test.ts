import { describe, it, expect, vi } from 'vitest';
import { Response } from './Response';

/** Minimal Express response stub recording what was set. */
function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    setHeader: vi.fn(function (this: any, k: string, v: string) {
      this.headers[k] = v;
      return this;
    }),
    send: vi.fn(function (this: any, b: unknown) {
      this.body = b;
      return this;
    }),
  };
  return res;
}

describe('Response', () => {
  it('stores status, body and headers', () => {
    const r = new Response(200, { ok: true }, { 'x-test': '1' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(r.headers).toEqual({ 'x-test': '1' });
  });

  it('apply() writes status, body and object headers to res', () => {
    const res = mockRes();
    new Response(201, { id: 'a' }, { 'x-h': 'v' }).apply(res as never);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 'a' });
    expect(res.headers['x-h']).toBe('v');
  });

  it('apply() supports Map headers', () => {
    const res = mockRes();
    const headers = new Map([['x-map', 'm']]);
    new Response(200, {}, headers).apply(res as never);
    expect(res.headers['x-map']).toBe('m');
  });

  describe('factories', () => {
    it('OK() builds a 200 with the given body', () => {
      const r = Response.OK({ hello: 'world' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ hello: 'world' });
    });

    it('Created() builds a 201', () => {
      expect(Response.Created({}).status).toBe(201);
    });

    it('NoContent() builds a 204', () => {
      expect(Response.NoContent().status).toBe(204);
    });

    it('factory valueOf() returns the status code (usable as number)', () => {
      expect(+Response.OK).toBe(200);
      expect(+Response.NotFound).toBe(404);
    });

    it('defaults body to the status name when omitted', () => {
      expect(Response.OK().body).toBe('OK');
    });
  });
});
