import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { TestContainer } from '@xenosisorg/xenosis-testing';
import { setupTestApp } from './setup';

/**
 * Service-level test for {{serviceName}}. setupTestApp() (in ./setup.ts) boots
 * the real service in-process. Two ways to drive it — use whichever fits:
 *
 *   1. supertest(ctx.server) — assert the raw HTTP contract (status, body).
 *      Used below.
 *   2. ctx.client(myApi) — call through the typed `defineServiceApi` contract,
 *      exactly like a sibling service would, but in-process:
 *
 *        import myApi from '@yourscope/{{nameKebab}}-api';
 *        const api = ctx.client(myApi);
 *        const out = await api.someMethod({ ... });   // type-safe, zod-validated
 *
 * Replace these with tests for your own routes.
 */
describe('{{serviceName}}: /api/v1/example', () => {
  let ctx: TestContainer;

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
