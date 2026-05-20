import { describe, it, expect } from 'vitest';
import { deriveCradleKey, categoryToSuffix } from './autoload.loader';

describe('categoryToSuffix', () => {
  it('singularizes plural category keys', () => {
    expect(categoryToSuffix('repositories')).toBe('repository');
    expect(categoryToSuffix('services')).toBe('service');
    expect(categoryToSuffix('controllers')).toBe('controller');
    expect(categoryToSuffix('middlewares')).toBe('middleware');
    expect(categoryToSuffix('jobs')).toBe('job');
  });

  it('handles -ies → -y', () => {
    expect(categoryToSuffix('gateways')).toBe('gateway');
    expect(categoryToSuffix('factories')).toBe('factory');
  });

  it('leaves single-word non-plural keys as-is', () => {
    expect(categoryToSuffix('config')).toBe('config');
  });
});

describe('deriveCradleKey', () => {
  it('maps PascalCase filename → camelCase cradle key with category suffix', () => {
    expect(deriveCradleKey('User.repository.ts', 'repository')).toBe('userRepository');
    expect(deriveCradleKey('UserAccount.repository.ts', 'repository')).toBe(
      'userAccountRepository',
    );
    expect(deriveCradleKey('Auth.service.ts', 'service')).toBe('authService');
    expect(deriveCradleKey('Heartbeat.job.ts', 'job')).toBe('heartbeatJob');
  });

  it('works for .js / .mjs / .cjs files too', () => {
    expect(deriveCradleKey('User.repository.js', 'repository')).toBe('userRepository');
    expect(deriveCradleKey('User.repository.mjs', 'repository')).toBe('userRepository');
  });

  it('is case-insensitive on the suffix match', () => {
    expect(deriveCradleKey('User.Repository.ts', 'repository')).toBe('userRepository');
  });

  it('returns null when the filename does not match the category suffix', () => {
    expect(deriveCradleKey('User.service.ts', 'repository')).toBeNull();
    expect(deriveCradleKey('random.ts', 'repository')).toBeNull();
  });

  it('returns null when there is no base before the suffix', () => {
    expect(deriveCradleKey('.repository.ts', 'repository')).toBeNull();
  });
});
