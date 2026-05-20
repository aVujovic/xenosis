import { describe, it, expect, vi } from 'vitest';
import { buildReliabilityPolicy, PeerHttpError } from './reliability';

describe('PeerHttpError', () => {
  it('carries status, peer, method, url, body and a descriptive message', () => {
    const e = new PeerHttpError(502, 'billing', 'POST', '/charges', { x: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(502);
    expect(e.peer).toBe('billing');
    expect(e.name).toBe('PeerHttpError');
    expect(e.message).toContain('502');
    expect(e.body).toEqual({ x: 1 });
  });
});

describe('buildReliabilityPolicy', () => {
  it('does not retry by default (attempts: 0)', async () => {
    const policy = buildReliabilityPolicy({ timeoutMs: 1000 });
    const fn = vi.fn(async () => {
      throw new PeerHttpError(503, 'p', 'GET', '/', null);
    });
    await expect(policy.execute(fn)).rejects.toBeInstanceOf(PeerHttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a configured status, then succeeds', async () => {
    const policy = buildReliabilityPolicy({
      timeoutMs: 1000,
      retry: { attempts: 3, backoffMs: 1, retryOnStatus: [503] },
    });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new PeerHttpError(503, 'p', 'GET', '/', null);
      return 'ok';
    });
    await expect(policy.execute(fn)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('retries on any thrown error (handleAll), exhausts attempts then rejects', async () => {
    // The policy uses cockatiel handleAll.orWhen(...), so it retries on ANY
    // error — retryOnStatus only widens, it does not restrict. This matches
    // the documented behaviour: retry on any thrown error OR matching status.
    const policy = buildReliabilityPolicy({
      timeoutMs: 1000,
      retry: { attempts: 3, backoffMs: 1, retryOnStatus: [503] },
    });
    const fn = vi.fn(async () => {
      throw new PeerHttpError(400, 'p', 'GET', '/', null);
    });
    await expect(policy.execute(fn)).rejects.toMatchObject({ status: 400 });
    // maxAttempts: 3 → 1 initial + 3 retries = 4 calls total.
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('times out a call that exceeds timeoutMs', async () => {
    const policy = buildReliabilityPolicy({ timeoutMs: 20 });
    const fn = () => new Promise((resolve) => setTimeout(() => resolve('late'), 200));
    await expect(policy.execute(fn as never)).rejects.toBeTruthy();
  });

  it('passes through a successful call unchanged', async () => {
    const policy = buildReliabilityPolicy({ timeoutMs: 1000 });
    await expect(policy.execute(async () => 42)).resolves.toBe(42);
  });
});
