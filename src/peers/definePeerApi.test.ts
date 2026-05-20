import { describe, it, expect } from 'vitest';
import { definePeerApi } from './definePeerApi';
import { defineServiceApi } from './defineServiceApi';

type Api = {
  createCharge(input: { amount: number }): Promise<{ id: string }>;
  getCharge(params: { id: string }): Promise<{ id: string }>;
};

const validSpec = {
  name: 'billing',
  routes: {
    createCharge: { method: 'POST' as const, path: '/api/v1/charges' },
    getCharge: { method: 'GET' as const, path: '/api/v1/charges/:id' },
  },
};

describe('definePeerApi', () => {
  it('returns the spec for a valid definition', () => {
    const api = definePeerApi<Api>(validSpec);
    expect(api.name).toBe('billing');
    expect(api.routes.createCharge.method).toBe('POST');
  });

  it('freezes the returned spec', () => {
    const api = definePeerApi<Api>(validSpec);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('throws when name is missing', () => {
    expect(() =>
      definePeerApi({ routes: validSpec.routes } as never),
    ).toThrow(/name is required/);
  });

  it('throws when routes is missing', () => {
    expect(() => definePeerApi({ name: 'x' } as never)).toThrow(/routes is required/);
  });

  it('throws when a route is missing method or path', () => {
    expect(() =>
      definePeerApi({
        name: 'x',
        routes: { broken: { method: 'GET' } as never },
      } as never),
    ).toThrow(/missing method or path/);
  });
});

describe('defineServiceApi', () => {
  it('delegates to definePeerApi (valid spec passes through)', () => {
    const api = defineServiceApi<Api>(validSpec);
    expect(api.name).toBe('billing');
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('applies the same validation', () => {
    expect(() => defineServiceApi({ name: 'x' } as never)).toThrow(/routes is required/);
  });
});
