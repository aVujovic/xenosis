import { describe, it, expect, vi } from 'vitest';
import { Exception } from './Exception';

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

describe('Exception', () => {
  it('is an Error with status, body and a status-named name', () => {
    const ex = Exception.NotFound({ id: 'x' });
    expect(ex).toBeInstanceOf(Error);
    expect(ex.status).toBe(404);
    expect(ex.body).toEqual({ id: 'x' });
    expect(ex.name).toBe('NotFound');
  });

  it('maps factories to the right status codes', () => {
    expect(Exception.BadRequest().status).toBe(400);
    expect(Exception.Unauthorized().status).toBe(401);
    expect(Exception.Forbidden().status).toBe(403);
    expect(Exception.ImATeapot().status).toBe(418);
    expect(Exception.InternalServerError().status).toBe(500);
    expect(Exception.BadGateway().status).toBe(502);
  });

  it('factory valueOf() returns the status code', () => {
    expect(+Exception.PaymentRequired).toBe(402);
  });

  it('apply() (shared with Response) writes status + body', () => {
    const res = mockRes();
    Exception.Forbidden({ reason: 'blocked' }).apply(res as never);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ reason: 'blocked' });
  });

  it('accepts a custom error to preserve its name/message', () => {
    const cause = new Error('boom');
    cause.name = 'CustomError';
    const ex = new Exception(500, { detail: 'x' }, {}, cause);
    expect(ex.name).toBe('CustomError');
    expect(ex.message).toBe('boom');
    expect(ex.status).toBe(500);
  });

  it('can be thrown and caught as an Exception', () => {
    expect(() => {
      throw Exception.Conflict({ field: 'email' });
    }).toThrowError(Exception);
  });
});
