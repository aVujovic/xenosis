import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Handler, ROUTE_META } from './Handler';
import { Request } from './Request';
import { Response } from './Response';
import { Exception } from './Exception';

function mockReqRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    setHeader: vi.fn(),
    send: vi.fn(function (this: any, b: unknown) {
      this.body = b;
      return this;
    }),
  };
  return { req: {} as any, res, next: vi.fn() };
}

const meta = (h: unknown) => (h as any)[ROUTE_META];

describe('Handler', () => {
  it('runs a 0-selector handler and applies the Response', async () => {
    const { req, res, next } = mockReqRes();
    const built = Handler(async () => Response.OK({ ok: true }));
    await built(req, res as never, next);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('feeds selector results as positional args, left to right', async () => {
    const { res, next } = mockReqRes();
    const req = { body: { name: 'Al' }, params: { id: '7' } } as any;
    const built = Handler(
      Request.Params(z.object({ id: z.string() })),
      Request.Body(z.object({ name: z.string() })),
      async (params, body) => Response.OK({ id: params.id, name: body.name }),
    );
    await built(req, res as never, next);
    expect(res.body).toEqual({ id: '7', name: 'Al' });
  });

  it('forwards thrown Exception (from a selector) to next', async () => {
    const { res, next } = mockReqRes();
    const req = { body: {} } as any; // fails the schema
    const built = Handler(
      Request.Body(z.object({ name: z.string() })),
      async () => Response.OK({}),
    );
    await built(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Exception);
  });

  it('errors to next when the handler does not return a Response', async () => {
    const { req, res, next } = mockReqRes();
    const built = Handler(async () => ({ not: 'a response' }) as never);
    await built(req, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  describe('route metadata (for OpenAPI)', () => {
    it('aggregates request selector schemas', () => {
      const bodySchema = z.object({ name: z.string() });
      const querySchema = z.object({ q: z.string() });
      const built = Handler(
        Request.Body(bodySchema),
        Request.Query(querySchema),
        async () => Response.OK({}),
      );
      const m = meta(built);
      expect(m.request).toHaveLength(2);
      expect(m.request[0]).toMatchObject({ in: 'body', schema: bodySchema });
      expect(m.request[1]).toMatchObject({ in: 'query', schema: querySchema });
      expect(m.response).toBeUndefined();
    });

    it('ignores non-selector args (custom resolvers without meta)', () => {
      const resolver = async () => ({ tenant: 't' }); // no SELECTOR_META
      const built = Handler(
        Request.Body(z.object({ x: z.number() })),
        resolver,
        async () => Response.OK({}),
      );
      expect(meta(built).request).toHaveLength(1);
    });

    it('.returns(schema) records the response schema and is chainable', () => {
      const responseSchema = z.object({ id: z.string() });
      const built = Handler(async () => Response.OK({})).returns(responseSchema);
      expect(meta(built).response).toBe(responseSchema);
      // chainable: returns the same handler function
      const again = built.returns(responseSchema);
      expect(again).toBe(built);
    });
  });
});
