import { describe, it, expect } from 'vitest';
import { xenosisConfigSchema, defineConfigSchema, z } from './index';

describe('xenosisConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const r = xenosisConfigSchema.safeParse({ name: 'svc', port: 4001 });
    expect(r.success).toBe(true);
  });

  it('passes through unknown top-level keys (forward-compat)', () => {
    const r = xenosisConfigSchema.safeParse({ name: 'svc', myCustom: { a: 1 } });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as any).myCustom).toEqual({ a: 1 });
  });

  it('rejects a wrong-typed known field', () => {
    const r = xenosisConfigSchema.safeParse({ port: 'not-a-number' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(['port']);
  });

  it('validates the authentication block shape', () => {
    expect(
      xenosisConfigSchema.safeParse({ authentication: { enabled: true, token: 's' } }).success,
    ).toBe(true);
    expect(
      xenosisConfigSchema.safeParse({ authentication: { enabled: 'yes' } }).success,
    ).toBe(false);
  });

  it('validates a peer binding', () => {
    const ok = xenosisConfigSchema.safeParse({
      peers: { billing: { package: '@x/billing-api', transport: 'http', baseUrl: 'http://x' } },
    });
    expect(ok.success).toBe(true);
    const bad = xenosisConfigSchema.safeParse({
      peers: { billing: { package: '@x/billing-api', transport: 'grpc', baseUrl: 'http://x' } },
    });
    expect(bad.success).toBe(false); // transport must be 'http'
  });
});

describe('defineConfigSchema', () => {
  it('extends the base with typed user keys', () => {
    const schema = defineConfigSchema({
      stripe: z.object({ secretKey: z.string() }),
    });
    // base key + user key both validated
    expect(schema.safeParse({ name: 'svc', stripe: { secretKey: 'sk' } }).success).toBe(true);
    expect(schema.safeParse({ name: 'svc', stripe: { secretKey: 123 } }).success).toBe(false);
  });
});
