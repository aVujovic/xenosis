import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execa } from 'execa';
import * as clack from '@clack/prompts';
import { writeManifest } from './generate-manifest';
import { findWorkspaceRoot } from '../lib/workspace';

interface Opts {
  flags: Record<string, string | boolean>;
}

/**
 * OPTIONAL production bundle. The default prod path needs no build at all — a
 * Xenosis service runs from source with tsx (`pnpm start` →
 * `node --import tsx src/service.ts`), so this command is only for users who
 * specifically want a bundled artifact.
 *
 * Two modes, auto-detected:
 *   • Service (`src/service.ts`): write the autoload manifest, then bundle with
 *     tsup (workspace packages bundled, real npm deps external) → dist/service.js.
 *   • Package (`src/index.ts`): compile with tsup → dist/index.js + .d.ts. The
 *     package's publishConfig points main/exports at dist for production while
 *     src stays the dev/test entry.
 */
export async function runBuild(_opts: Opts): Promise<void> {
  const cwd = process.cwd();
  const isService = existsSync(resolve(cwd, 'src/service.ts')) ||
    existsSync(resolve(cwd, 'src/service.js'));

  if (!isService) {
    return buildPackage(cwd);
  }

  clack.intro('Bundle a Xenosis service (optional — default prod runs via tsx)');

  // Manifest so autoload resolves modules statically inside the bundle.
  const s = clack.spinner();
  s.start('Generating autoload manifest');
  const count = await writeManifest(cwd);
  s.stop(count === null ? 'No autoloaded files matched' : `Manifest (${count} entries)`);

  // Bundle with tsup. Pass the workspace scope so workspace TS packages get
  // bundled (plain Node can't import their .ts from node_modules).
  const scope = await detectWorkspaceScope(cwd);
  const s2 = clack.spinner();
  s2.start('Bundling src/service.ts → dist/');
  try {
    await execa('pnpm', ['exec', 'tsup'], {
      cwd,
      stdio: 'pipe',
      env: scope ? { XENOSIS_BUNDLE_SCOPES: scope } : {},
    });
  } catch (err) {
    s2.stop('Bundle failed');
    clack.cancel(
      `tsup failed. Ensure tsup + a tsup.config are present. ` +
        `Error: ${(err as Error).message}`,
    );
    process.exit(1);
  }
  s2.stop('Bundled to dist/');

  clack.outro(
    '🎉 Bundle ready at dist/service.js. Default prod needs no bundle — ' +
      '`pnpm start` runs from source via tsx.',
  );
}

/**
 * Build a workspace package (schema / shared-module / peer-API) — compile
 * src/index.ts to dist with type declarations. Run from the package dir.
 */
async function buildPackage(cwd: string): Promise<void> {
  if (!existsSync(resolve(cwd, 'src/index.ts'))) {
    clack.cancel(
      'No src/service.ts or src/index.ts found. Run `xenosis build` from a ' +
        'service or a workspace package directory.',
    );
    process.exit(1);
  }
  clack.intro('Build a Xenosis workspace package');
  const s = clack.spinner();
  s.start('Compiling src/index.ts → dist/');
  try {
    await execa(
      'pnpm',
      ['exec', 'tsup', 'src/index.ts', '--format', 'esm', '--dts', '--out-dir', 'dist', '--clean'],
      { cwd, stdio: 'pipe' },
    );
  } catch (err) {
    s.stop('Build failed');
    clack.cancel(
      `tsup failed. Ensure tsup is installed (devDependency). ` +
        `Error: ${(err as Error).message}`,
    );
    process.exit(1);
  }
  s.stop('Compiled to dist/');
  clack.outro(
    '🎉 Package built. Its publishConfig points main/exports at dist for ' +
      'production; src stays the dev/test entry.',
  );
}

/** Read the workspace `scope` (e.g. @example) so tsup bundles workspace pkgs. */
async function detectWorkspaceScope(start: string): Promise<string | null> {
  const root = await findWorkspaceRoot(start);
  if (!root) return null;
  try {
    const ws = JSON.parse(
      readFileSync(resolve(root, 'xenosis.workspace.json'), 'utf-8'),
    );
    return typeof ws.scope === 'string' ? ws.scope : null;
  } catch {
    return null;
  }
}
