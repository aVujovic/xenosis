import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { TestContainer } from '@xenosisorg/xenosis-testing';
import billingApi from '@example/billing-api';
import { setupTestApp, TEST_USER } from './setup';

/**
 * Service-level test for billing-service. `setupTestApp` (in ./setup.ts) boots
 * the real service in-process with default peer mocks; tests override only what
 * they need. POST /api/v1/charges → ChargeService.create → this.api.users.list
 * (mocked) → persists the charge.
 *
 * Two ways to drive the service — use whichever fits:
 *   1. supertest(ctx.server) — assert the raw HTTP contract (status, body).
 *   2. ctx.client(billingApi) — call through the typed `defineServiceApi`
 *      contract, exactly like a sibling service would (`api.billing.createCharge`),
 *      but in-process. Type-safe, zod-validated, path params resolved.
 */
describe('billing-service: POST /api/v1/charges', () => {
  let ctx: TestContainer;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Option 1: raw HTTP via supertest ───────────────────────────────────
  it('charges a known user (HTTP)', async () => {
    const res = await request(ctx.server)
      .post('/api/v1/charges')
      .send({ userId: TEST_USER.id, amount: 4200, currency: 'USD' })
      .expect(201);

    expect(res.body).toMatchObject({ status: 'completed', amount: 4200, currency: 'USD' });
    expect(res.body.id).toBeTruthy();
  });

  it('rejects an unknown user (HTTP, override users.list to empty)', async () => {
    const empty = await setupTestApp({ peers: { users: { list: async () => [] } } });
    await request(empty.server)
      .post('/api/v1/charges')
      .send({ userId: TEST_USER.id, amount: 100, currency: 'USD' })
      .expect(500); // ChargeService throws "Cannot charge unknown user"
    await empty.cleanup();
  });

  it('validates the request body (HTTP, zod) — 400 on bad input', async () => {
    await request(ctx.server)
      .post('/api/v1/charges')
      .send({ userId: 'not-a-uuid', amount: -5, currency: 'US' })
      .expect(400);
  });

  // ── Option 2: typed client via ctx.client (the api.billing.* path) ──────
  it('charges a known user (typed client)', async () => {
    const billing = ctx.client(billingApi);
    const charge = await billing.createCharge({
      userId: TEST_USER.id,
      amount: 4200,
      currency: 'USD',
    });
    // Fully typed: charge.status is 'completed', charge.amount is number, etc.
    expect(charge).toMatchObject({ status: 'completed', amount: 4200, currency: 'USD' });
    expect(charge.id).toBeTruthy();
  });

  it('typed client surfaces a 500 as a thrown error', async () => {
    const empty = await setupTestApp({ peers: { users: { list: async () => [] } } });
    const billing = empty.client(billingApi);
    await expect(
      billing.createCharge({ userId: TEST_USER.id, amount: 100, currency: 'USD' }),
    ).rejects.toThrow();
    await empty.cleanup();
  });

  it('typed client resolves :id path params (createCharge → getCharge)', async () => {
    const billing = ctx.client(billingApi);
    const created = await billing.createCharge({
      userId: TEST_USER.id,
      amount: 999,
      currency: 'EUR',
    });
    // GET /api/v1/charges/:id — id goes into the path, not the body.
    const fetched = await billing.getCharge({ id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched).toMatchObject({ amount: 999, currency: 'EUR' });
  });
});
