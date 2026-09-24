import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sync as globSync } from 'glob';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { globFiles, toGlobPattern } from './globFiles';

/**
 * Every test here runs on macOS / Linux. The win32 rules are driven
 * explicitly through `path.win32` — nobody runs the suite on Windows, and a
 * test that only fails there is a test that never runs.
 */

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'xenosis-glob-'));
  mkdirSync(path.join(root, 'src', 'services'), { recursive: true });
  writeFileSync(
    path.join(root, 'src', 'services', 'Sweeper.service.mjs'),
    'export default class SweeperService {}\n',
  );
  writeFileSync(
    path.join(root, 'src', 'services', 'Mailer.service.mjs'),
    'export default class MailerService {}\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const names = (files: string[]) => files.map((f) => path.basename(f)).sort();
const BOTH = ['Mailer.service.mjs', 'Sweeper.service.mjs'];

describe('premise: path.join under win32 rules breaks a glob pattern', () => {
  it('path.win32.join produces a backslash-delimited string', () => {
    const joined = path.win32.join('C:\\repo\\svc', 'src/services/*.service.ts');
    expect(joined).toBe('C:\\repo\\svc\\src\\services\\*.service.ts');
    expect(joined).not.toContain('/');
  });

  it('glob reads those backslashes as escapes and silently returns [] with the files on disk', () => {
    // The exact surgery the old loader did, with win32 rules applied on this host.
    const joined = path.win32.join(root, 'src/services/*.service.mjs');
    expect(joined).toContain('\\');
    expect(globSync(joined)).toEqual([]); // no throw — that is what made it silent
    // Sanity: the same files are matched fine through cwd.
    expect(names(globFiles(['src/services/*.service.mjs'], root))).toEqual(BOTH);
  });
});

describe('toGlobPattern', () => {
  it('converts win32 separators to forward slashes', () => {
    expect(toGlobPattern('C:\\repo\\svc\\src\\services\\*.service.ts', '\\')).toBe(
      'C:/repo/svc/src/services/*.service.ts',
    );
  });

  it('leaves a forward-slash pattern unchanged under win32 rules', () => {
    const p = 'C:/repo/svc/src/api/**/*.controller.ts';
    expect(toGlobPattern(p, '\\')).toBe(p);
  });

  it('is a no-op on POSIX, so backslash keeps its escape meaning there', () => {
    const p = 'src/weird\\*dir/*.ts';
    expect(toGlobPattern(p, '/')).toBe(p);
  });
});

describe('globFiles under win32 path rules (driven from this host)', () => {
  it('resolves a relative pattern through cwd — never joined — and matches', () => {
    const files = globFiles(['src/services/*.service.mjs'], root, path.win32);
    expect(names(files)).toEqual(BOTH);
    for (const f of files) expect(path.isAbsolute(f)).toBe(true);
  });

  it('normalises an absolute pattern containing backslashes before it reaches glob, and matches', () => {
    // How the testing kit builds its defaults: join(serviceRoot, pattern).
    const absolute = path.win32.join(root, 'src/services/*.service.mjs');
    expect(absolute).toContain('\\');
    expect(path.win32.isAbsolute(absolute)).toBe(true);
    expect(names(globFiles([absolute], root, path.win32))).toEqual(BOTH);
  });

  it('passes an absolute pattern that already uses forward slashes through unchanged', () => {
    const absolute = `${root}/src/services/*.service.mjs`;
    expect(toGlobPattern(absolute, path.win32.sep)).toBe(absolute);
    expect(names(globFiles([absolute], root, path.win32))).toEqual(BOTH);
  });

  it('returns [] for a pattern that legitimately matches nothing — never an error', () => {
    expect(globFiles(['src/nowhere/*.service.mjs'], root, path.win32)).toEqual([]);
    expect(
      globFiles([path.win32.join(root, 'src/nowhere/*.service.mjs')], root, path.win32),
    ).toEqual([]);
  });

  it('de-duplicates files matched by overlapping patterns', () => {
    const files = globFiles(['src/services/*.service.mjs', 'src/**/*.service.mjs'], root);
    expect(names(files)).toEqual(BOTH);
  });
});
