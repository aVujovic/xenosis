import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createContainer } from 'awilix';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ILogger } from '../types';
import { deriveCradleKey, categoryToSuffix, runAutoload } from './autoload.loader';

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

// ─── runAutoload end-to-end against on-disk fixtures ────────────────────────

function makeLogger() {
  const warns: string[] = [];
  const logger = {
    info() {},
    error() {},
    debug() {},
    warn(m: unknown) {
      warns.push(typeof m === 'string' ? m : JSON.stringify(m));
    },
  } as unknown as ILogger;
  return { logger, warns };
}

function writeService(root: string, name: string) {
  mkdirSync(path.join(root, 'src', 'services'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'services', `${name}.service.mjs`),
    `export default class ${name}Service {}\n`,
  );
}

describe('runAutoload', () => {
  /** Live-glob fixture: two services, no manifest. */
  let liveRoot: string;
  /** Manifest fixture: Sweeper is in the manifest; Ghost is on disk only. */
  let manifestRoot: string;

  beforeAll(() => {
    liveRoot = mkdtempSync(path.join(tmpdir(), 'xenosis-autoload-live-'));
    writeService(liveRoot, 'Sweeper');
    writeService(liveRoot, 'Mailer');

    manifestRoot = mkdtempSync(path.join(tmpdir(), 'xenosis-autoload-manifest-'));
    writeService(manifestRoot, 'Sweeper');
    writeService(manifestRoot, 'Ghost');
    writeFileSync(
      path.join(manifestRoot, 'src', '.xenosis-manifest.mjs'),
      [
        'export const __xenosisManifest = {',
        "  'src/services/Sweeper.service.mjs': () => import('./services/Sweeper.service.mjs'),",
        '};',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(liveRoot, { recursive: true, force: true });
    rmSync(manifestRoot, { recursive: true, force: true });
  });

  it('live glob: a relative pattern resolves through cwd and registers every match', async () => {
    const container = createContainer();
    const { logger, warns } = makeLogger();
    await runAutoload(
      container,
      { services: { pattern: 'src/services/*.service.mjs' } },
      logger,
      { cwd: liveRoot },
    );
    expect(container.hasRegistration('sweeperService')).toBe(true);
    expect(container.hasRegistration('mailerService')).toBe(true);
    expect(container.cradle.sweeperService.constructor.name).toBe('SweeperService');
    expect(warns).toEqual([]);
  });

  it('live glob: an absolute pattern (how the testing kit builds its defaults) works too', async () => {
    const container = createContainer();
    const { logger } = makeLogger();
    await runAutoload(
      container,
      { services: { pattern: path.join(liveRoot, 'src/services/*.service.mjs') } },
      logger,
      { cwd: liveRoot },
    );
    expect(container.hasRegistration('sweeperService')).toBe(true);
    expect(container.hasRegistration('mailerService')).toBe(true);
  });

  it('live glob: a pattern that matches nothing warns "matched 0 files" and registers nothing — no throw', async () => {
    const container = createContainer();
    const { logger, warns } = makeLogger();
    await expect(
      runAutoload(container, { jobs: { pattern: 'src/jobs/*.job.mjs' } }, logger, { cwd: liveRoot }),
    ).resolves.toBeUndefined();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('matched 0 files');
  });

  it('manifest present: takes the manifest path, not the glob — a file on disk but absent from the manifest is not registered', async () => {
    const container = createContainer();
    const { logger } = makeLogger();
    await runAutoload(
      container,
      { services: { pattern: 'src/services/*.service.mjs' } },
      logger,
      { cwd: manifestRoot },
    );
    expect(container.hasRegistration('sweeperService')).toBe(true);
    expect(container.hasRegistration('ghostService')).toBe(false);
  });
});
