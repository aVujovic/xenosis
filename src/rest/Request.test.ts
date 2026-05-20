import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Request, SELECTOR_META, type SelectorMeta } from './Request';
import { Exception } from './Exception';

const bodySchema = z.object({ name: z.string().min(1) });
const querySchema = z.object({ limit: z.coerce.number().int().positive() });

const meta = (fn: unknown) =>
  (fn as { [SELECTOR_META]?: SelectorMeta })[SELECTOR_META];

describe('Request selectors', () => {
  it('Body validates and returns parsed data', async () => {
    const selector = Request.Body(bodySchema);
    const out = await selector({ body: { name: 'Alice' } } as never);
    expect(out).toEqual({ name: 'Alice' });
  });

  it('Query coerces and returns parsed data', async () => {
    const selector = Request.Query(querySchema);
    const out = await selector({ query: { limit: '25' } } as never);
    expect(out).toEqual({ limit: 25 });
  });

  it('throws Exception.BadRequest on invalid input', async () => {
    const selector = Request.Body(bodySchema);
    await expect(selector({ body: { name: '' } } as never)).rejects.toBeInstanceOf(
      Exception,
    );
    await expect(
      selector({ body: { name: '' } } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('BadRequest body carries the zod issues (message + path)', async () => {
    const selector = Request.Body(bodySchema);
    try {
      await selector({ body: {} } as never);
      throw new Error('should have thrown');
    } catch (err) {
      const ex = err as Exception;
      expect(ex.status).toBe(400);
      expect(Array.isArray(ex.body)).toBe(true);
      expect((ex.body as any[])[0]).toHaveProperty('path');
      expect((ex.body as any[])[0]).toHaveProperty('message');
    }
  });

  it('stamps SELECTOR_META with the property and schema', () => {
    expect(meta(Request.Body(bodySchema))).toMatchObject({ in: 'body', schema: bodySchema });
    expect(meta(Request.Query(querySchema))).toMatchObject({ in: 'query' });
    expect(meta(Request.Params(bodySchema))).toMatchObject({ in: 'params' });
    expect(meta(Request.Headers(bodySchema))).toMatchObject({ in: 'headers' });
  });

  it('reads from the correct request property per selector', async () => {
    const params = await Request.Params(z.object({ id: z.string() }))(
      { params: { id: '42' } } as never,
    );
    expect(params).toEqual({ id: '42' });
  });
});
