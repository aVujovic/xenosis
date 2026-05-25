import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestApp } from './setup.js';

/**
 * Service-level test for {{serviceName}}. setupTestApp() boots the real service
 * in-process. Two ways to drive it — use whichever fits:
 *
 *   1. supertest(ctx.server) — assert the raw HTTP contract (status, body).
 *      Used below.
 *   2. ctx.client(myApi) — call through the typed defineServiceApi contract,
 *      like a sibling service would, but in-process:
 *        import myApi from '@yourscope/{{nameKebab}}-api';
 *        const out = await ctx.client(myApi).someMethod({ ... });
 *
 * Replace these with tests for your own routes.
 */
describe('{{serviceName}}: /api/v1/example', () => {
  /** @type {import('@xenosisorg/testing').TestContainer} */
  let ctx;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('GET / returns a greeting', async () => {
    const res = await request(ctx.server).get('/api/v1/example').expect(200);
    expect(res.body.message).toContain('Hello');
  });

  it('POST / greets the given name', async () => {
    const res = await request(ctx.server)
      .post('/api/v1/example')
      .send({ name: 'Ada' })
      .expect(200);
    expect(res.body.message).toContain('Ada');
  });

  it('POST / rejects an empty name (zod validation → 400)', async () => {
    await request(ctx.server).post('/api/v1/example').send({ name: '' }).expect(400);
  });
});
