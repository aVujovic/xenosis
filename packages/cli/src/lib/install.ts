import { execa } from 'execa';
import { log } from './log';

/**
 * Run `pnpm install` from a workspace root. Best-effort: logs but doesn't throw
 * on failure so scaffolding still leaves a usable tree on disk.
 */
export async function pnpmInstall(cwd: string, skip = false): Promise<void> {
  if (skip) {
    log.hint('Skipped pnpm install (--no-install)');
    return;
  }
  try {
    log.info('Running pnpm install …');
    await execa('pnpm', ['install'], { cwd, stdio: 'inherit' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`pnpm install failed: ${msg}`);
    log.hint('You can re-run it manually from the workspace root.');
  }
}
