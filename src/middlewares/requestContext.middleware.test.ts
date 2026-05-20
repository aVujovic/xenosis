import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  isCallerAllowed,
  extractToken,
  isAuthExempt,
} from './requestContext.middleware';

/** Build a minimal Request stub for extractToken. */
function reqStub(headers: Record<string, string> = {}, query: Record<string, unknown> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header: (name: string) => lower[name.toLowerCase()],
    query,
  } as unknown as Request;
}

describe('isCallerAllowed', () => {
  it('allows everyone when allowedCallers is undefined (default open)', () => {
    expect(isCallerAllowed('users', undefined)).toBe(true);
    expect(isCallerAllowed(undefined, undefined)).toBe(true);
  });

  it('allows everyone when allowedCallers is empty', () => {
    expect(isCallerAllowed('anyone', [])).toBe(true);
  });

  it('allows a caller present in the list', () => {
    expect(isCallerAllowed('users', ['users', 'orders'])).toBe(true);
  });

  it('rejects a caller not in the list', () => {
    expect(isCallerAllowed('billing', ['users', 'orders'])).toBe(false);
  });

  it('lets unidentified (no x-xenosis-caller) requests through even when a list is set', () => {
    // Browser / public traffic carries no caller header — boundaries only
    // gate peer-to-peer calls.
    expect(isCallerAllowed(undefined, ['users'])).toBe(true);
  });
});

describe('extractToken', () => {
  it('reads Authorization: Bearer <token>', () => {
    expect(extractToken(reqStub({ Authorization: 'Bearer abc123' }))).toBe('abc123');
  });

  it('is case-insensitive on the Bearer scheme', () => {
    expect(extractToken(reqStub({ authorization: 'bearer xyz' }))).toBe('xyz');
  });

  it('reads x-auth-token header', () => {
    expect(extractToken(reqStub({ 'x-auth-token': 'tok' }))).toBe('tok');
  });

  it('reads ?authToken query param', () => {
    expect(extractToken(reqStub({}, { authToken: 'qtok' }))).toBe('qtok');
  });

  it('prefers Authorization over the other sources', () => {
    expect(
      extractToken(reqStub({ Authorization: 'Bearer a', 'x-auth-token': 'b' }, { authToken: 'c' })),
    ).toBe('a');
  });

  it('returns undefined when no token is present', () => {
    expect(extractToken(reqStub())).toBeUndefined();
  });

  it('ignores a non-Bearer Authorization header', () => {
    expect(extractToken(reqStub({ Authorization: 'Basic zzz' }))).toBeUndefined();
  });
});

describe('isAuthExempt', () => {
  it('always exempts /healthcheck and its sub-paths', () => {
    expect(isAuthExempt('/healthcheck', undefined)).toBe(true);
    expect(isAuthExempt('/healthcheck/db', undefined)).toBe(true);
  });

  it('exempts configured prefixes', () => {
    expect(isAuthExempt('/openapi.json', ['/openapi.json', '/docs'])).toBe(true);
    expect(isAuthExempt('/docs/index.html', ['/docs'])).toBe(true);
  });

  it('does not exempt unrelated paths', () => {
    expect(isAuthExempt('/api/v1/users', ['/docs'])).toBe(false);
    expect(isAuthExempt('/api/v1/users', undefined)).toBe(false);
  });

  it('does not treat a prefix as a substring match', () => {
    // /docs should not exempt /docsmith
    expect(isAuthExempt('/docsmith', ['/docs'])).toBe(false);
  });
});
