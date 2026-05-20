import { describe, it, expect } from 'vitest';
import { buildGraph, type ServiceNode } from './graph';

const node = (
  name: string,
  calls: string[],
  allowedCallers?: string[],
): ServiceNode => ({ name, calls, allowedCallers });

describe('buildGraph', () => {
  it('reports no violations when callees have no allowedCallers (open)', () => {
    const { violations } = buildGraph([
      node('users', ['billing']),
      node('billing', []),
    ]);
    expect(violations).toEqual([]);
  });

  it('reports no violation when the caller is in allowedCallers', () => {
    const { violations } = buildGraph([
      node('users', ['billing']),
      node('billing', [], ['users']),
    ]);
    expect(violations).toEqual([]);
  });

  it('flags a call to a peer that does not allow the caller', () => {
    const { violations } = buildGraph([
      node('users', ['billing']),
      node('billing', [], ['orders']),
    ]);
    expect(violations).toEqual([{ from: 'users', to: 'billing' }]);
  });

  it('treats an empty allowedCallers list as open', () => {
    const { violations } = buildGraph([
      node('users', ['billing']),
      node('billing', [], []),
    ]);
    expect(violations).toEqual([]);
  });

  it('skips calls to peers not present in the workspace (external)', () => {
    const { violations } = buildGraph([node('users', ['stripe'])]);
    expect(violations).toEqual([]);
  });

  it('detects multiple violations across services', () => {
    const { violations } = buildGraph([
      node('users', ['billing', 'notifications']),
      node('billing', [], ['orders']),
      node('notifications', [], ['orders']),
    ]);
    expect(violations).toEqual([
      { from: 'users', to: 'billing' },
      { from: 'users', to: 'notifications' },
    ]);
  });
});
