import { describe, it, expect } from 'vitest';
import { expandEnvPlaceholders } from './env.expand';

describe('expandEnvPlaceholders', () => {
  it('replaces a whole-value placeholder with the env value', () => {
    const out = expandEnvPlaceholders(
      { auth: { jwtSecret: '$env:JWT_SECRET' } },
      { env: { JWT_SECRET: 'super-secret' } },
    );
    expect(out).toEqual({ auth: { jwtSecret: 'super-secret' } });
  });

  it('leaves a missing placeholder as undefined so zod reports the right path', () => {
    const out = expandEnvPlaceholders(
      { auth: { jwtSecret: '$env:JWT_SECRET' } },
      { env: {} },
    );
    expect(out).toEqual({ auth: { jwtSecret: undefined } });
  });

  it('uses the :- default when the env is missing', () => {
    const out = expandEnvPlaceholders(
      { port: '$env:PORT:-4000' },
      { env: {} },
    );
    expect(out).toEqual({ port: 4000 });
  });

  it('throws on :? required when the env is missing', () => {
    expect(() =>
      expandEnvPlaceholders(
        { auth: { jwtSecret: '$env:JWT_SECRET:?required' } },
        { env: {} },
      ),
    ).toThrow(/required env variable "JWT_SECRET" is not set/);
  });

  it('coerces numeric strings to numbers for whole-value placeholders', () => {
    const out = expandEnvPlaceholders(
      { port: '$env:PORT', timeoutMs: '$env:TIMEOUT' },
      { env: { PORT: '4000', TIMEOUT: '5000' } },
    );
    expect(out).toEqual({ port: 4000, timeoutMs: 5000 });
  });

  it('coerces "true" / "false" to boolean for whole-value placeholders', () => {
    const out = expandEnvPlaceholders(
      { authentication: { enabled: '$env:AUTH_ENABLED' } },
      { env: { AUTH_ENABLED: 'true' } },
    );
    expect(out).toEqual({ authentication: { enabled: true } });
  });

  it('substitutes placeholders inside a larger string without coercion', () => {
    const out = expandEnvPlaceholders(
      { connectors: { psql: { url: 'postgresql://user:$env:PG_PASS@host:5432/db' } } },
      { env: { PG_PASS: 'p@ss' } },
    );
    expect(out).toEqual({
      connectors: { psql: { url: 'postgresql://user:p@ss@host:5432/db' } },
    });
  });

  it('walks arrays and nested objects', () => {
    const out = expandEnvPlaceholders(
      {
        connectors: {
          kafka: {
            type: 'kafka',
            brokers: ['$env:K1', '$env:K2:-localhost:9092'],
          },
        },
      },
      { env: { K1: 'broker1:9092' } },
    );
    expect(out).toEqual({
      connectors: {
        kafka: {
          type: 'kafka',
          brokers: ['broker1:9092', 'localhost:9092'],
        },
      },
    });
  });

  it('passes through values that contain no placeholder', () => {
    const input = { name: 'svc', port: 4000, env: 'development', flags: [1, 2, 3] };
    expect(expandEnvPlaceholders(input, { env: {} })).toEqual(input);
  });

  it('handles empty-string env as missing (so :- default fires)', () => {
    const out = expandEnvPlaceholders(
      { port: '$env:PORT:-4000' },
      { env: { PORT: '' } },
    );
    expect(out).toEqual({ port: 4000 });
  });

  it('does not coerce strings inside an interpolation', () => {
    const out = expandEnvPlaceholders(
      { msg: 'port is $env:PORT' },
      { env: { PORT: '4000' } },
    );
    expect(out).toEqual({ msg: 'port is 4000' });
  });

  it('reports the offending config path in the error message', () => {
    expect(() =>
      expandEnvPlaceholders(
        { connectors: { redis: { password: '$env:REDIS_PASS:?required' } } },
        { env: {} },
      ),
    ).toThrow(/connectors\.redis\.password/);
  });
});
