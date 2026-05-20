import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createPeerClient } from './createPeerClient';
import { PeerHttpError } from './reliability';
import type { PeerApi, PeerTransport } from './types';

/** A no-op reliability policy: just runs the fn. */
const passthroughPolicy = { execute: (fn: () => unknown) => fn() } as any;

/** Stub transport that records the request and returns a canned response. */
function stubTransport(response: unknown = { ok: true }) {
  const calls: any[] = [];
  const transport: PeerTransport = {
    execute: vi.fn(async (req: any) => {
      calls.push(req);
      return response;
    }),
  } as never;
  return { transport, calls };
}

const api: PeerApi<any> = {
  name: 'billing',
  routes: {
    createCharge: { method: 'POST', path: '/api/v1/charges' },
    getCharge: { method: 'GET', path: '/api/v1/charges/:id' },
    refund: { method: 'POST', path: '/api/v1/charges/:id/refund' },
  },
} as any;

function makeClient(transport: PeerTransport, extra: Partial<any> = {}) {
  return createPeerClient<any>({
    api,
    transport,
    policy: passthroughPolicy,
    ...extra,
  });
}

describe('createPeerClient', () => {
  it('POST sends the body as-is to the route path', async () => {
    const { transport, calls } = stubTransport();
    const client = makeClient(transport);
    await client.createCharge({ amount: 100, currency: 'USD' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/charges',
      body: { amount: 100, currency: 'USD' },
    });
  });

  it('substitutes :id into the path and strips it from a GET (no body)', async () => {
    const { transport, calls } = stubTransport();
    const client = makeClient(transport);
    await client.getCharge({ id: 'abc' });
    expect(calls[0].url).toBe('/api/v1/charges/abc');
    expect(calls[0].body).toBeUndefined(); // GET carries no body
  });

  it('substitutes :id for a POST and keeps the remaining body fields', async () => {
    const { transport, calls } = stubTransport();
    const client = makeClient(transport);
    await client.refund({ id: 'ch_1', reason: 'duplicate' });
    expect(calls[0].url).toBe('/api/v1/charges/ch_1/refund');
    expect(calls[0].body).toEqual({ reason: 'duplicate' }); // id stripped
  });

  it('throws when a required path param is missing', async () => {
    const { transport } = stubTransport();
    const client = makeClient(transport);
    await expect(client.getCharge({})).rejects.toThrow(/requires input field "id"/);
  });

  it('throws for an undeclared method (synchronously, on access)', () => {
    const { transport } = stubTransport();
    const client = makeClient(transport);
    // The Proxy get-trap throws when the unknown method is accessed.
    expect(() => (client as any).nope).toThrow(/not declared/);
  });

  it('sends apiKey, custom headers and trace headers', async () => {
    const { transport, calls } = stubTransport();
    const client = makeClient(transport, {
      apiKey: 'secret',
      customHeaders: { 'X-Vendor': 'v' },
      getTraceContext: () => ({ traceId: 't', spanId: 's' }),
    });
    await client.createCharge({ amount: 1 });
    expect(calls[0].headers).toMatchObject({
      'x-xenosis-peer-key': 'secret',
      'X-Vendor': 'v',
      'x-xenosis-trace-id': 't',
    });
  });

  it('validates input against bodySchema before sending', async () => {
    const { transport } = stubTransport();
    const validatedApi: PeerApi<any> = {
      name: 'billing',
      routes: {
        createCharge: {
          method: 'POST',
          path: '/c',
          bodySchema: z.object({ amount: z.number().positive() }),
        },
      },
    } as any;
    const client = createPeerClient<any>({ api: validatedApi, transport, policy: passthroughPolicy });
    await expect(client.createCharge({ amount: -1 })).rejects.toThrow(/validation failed/);
  });

  it('routes non-2xx through errorMapper when provided', async () => {
    const transport: PeerTransport = {
      execute: vi.fn(async () => {
        throw new PeerHttpError(402, 'billing', 'POST', '/c', { code: 'card' });
      }),
    } as never;
    const mappedApi: PeerApi<any> = {
      name: 'billing',
      routes: { createCharge: { method: 'POST', path: '/c' } },
      errorMapper: (status: number) => new Error(`mapped:${status}`),
    } as any;
    const client = createPeerClient<any>({ api: mappedApi, transport, policy: passthroughPolicy });
    await expect(client.createCharge({ amount: 1 })).rejects.toThrow('mapped:402');
  });

  it('parses the response with responseSchema when present', async () => {
    const { transport } = stubTransport({ id: 'ch_1', extra: 'dropped' });
    const respApi: PeerApi<any> = {
      name: 'billing',
      routes: {
        createCharge: {
          method: 'POST',
          path: '/c',
          responseSchema: z.object({ id: z.string() }),
        },
      },
    } as any;
    const client = createPeerClient<any>({ api: respApi, transport, policy: passthroughPolicy });
    const out = await client.createCharge({ amount: 1 });
    expect(out).toEqual({ id: 'ch_1' }); // strict schema strips unknown keys
  });
});
