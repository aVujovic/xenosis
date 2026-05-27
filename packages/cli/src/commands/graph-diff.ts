import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execa } from 'execa';
import pc from 'picocolors';
import { requireWorkspace } from '../lib/workspace';
import { log } from '../lib/log';
import {
  buildSnapshot,
  diffSnapshots,
  formatChanges,
  type ContractSnapshot,
} from '../lib/contract-snapshot';

const DEFAULT_PATH = '.xenosis/contract.json';

interface Opts {
  positional?: string;
  flags: Record<string, string | boolean>;
}

/**
 * `xenosis graph diff [base-ref]` — compares the workspace's current source
 * against a baseline contract snapshot. Two ways to source the baseline:
 *
 *   • A git ref (default: `main`) — we read `.xenosis/contract.json` from
 *     that ref via `git show <ref>:<path>`. Lets the same command work in
 *     a PR check without needing two clones.
 *   • The local file (`--file`) — useful for testing locally before pushing.
 *
 * Exit codes:
 *   • 0 — no breaking changes (additive changes are reported but pass).
 *   • 1 — one or more breaking changes.
 *   • 2 — could not load the baseline (missing snapshot in the ref / bad ref).
 *
 * `--json` outputs the change list as machine-readable JSON instead.
 * `--gha` formats breaking changes as GitHub Actions error annotations.
 */
export async function runGraphDiff({ positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();
  const path = typeof flags.file === 'string' ? flags.file : DEFAULT_PATH;
  const base = positional ?? (typeof flags.base === 'string' ? flags.base : 'main');
  const fromLocalFile = flags.file !== undefined;

  // 1. Load the baseline.
  let baseline: ContractSnapshot;
  try {
    if (fromLocalFile) {
      const raw = await readFile(resolve(root, path), 'utf-8');
      baseline = JSON.parse(raw) as ContractSnapshot;
    } else {
      // git show <base>:<path> — reads the file at the tip of the base ref
      // without checking it out.
      const { stdout } = await execa('git', ['show', `${base}:${path}`], { cwd: root });
      baseline = JSON.parse(stdout) as ContractSnapshot;
    }
  } catch (err) {
    log.err(
      fromLocalFile
        ? `Could not read baseline file "${path}": ${(err as Error).message}`
        : `Could not load "${path}" from git ref "${base}": ${(err as Error).message}`,
    );
    log.hint(
      fromLocalFile
        ? 'Pass a path that exists, or omit --file to read from git.'
        : 'Make sure the base ref exists and the snapshot has been committed there (run `xenosis graph snapshot` on the base branch).',
    );
    process.exitCode = 2;
    return;
  }

  // 2. Build the "next" snapshot from current source.
  const next = await buildSnapshot(root, config.structure.services);

  // 3. Diff.
  const changes = diffSnapshots(baseline, next);

  if (flags.json) {
    console.log(JSON.stringify({ changes }, null, 2));
  } else {
    const formatted = formatChanges(changes, {
      githubAnnotations: !!flags.gha,
    });
    if (formatted) console.log(formatted);
  }

  const breaking = changes.filter((c) => c.breaking);
  if (breaking.length > 0) {
    if (!flags.json && !flags.gha) {
      log.blank();
      log.hint(
        `Fix: update the caller services that reference the changed routes, or revert the contract change. ` +
          `Run \`xenosis graph snapshot\` on the base branch to refresh the baseline once callers are caught up.`,
      );
    }
    process.exitCode = 1;
  } else if (!flags.json && !flags.gha && changes.length === 0) {
    log.ok(`No contract changes vs ${fromLocalFile ? path : base}.`);
  } else if (!flags.json && !flags.gha) {
    log.ok(`${changes.length} additive change${changes.length === 1 ? '' : 's'}; no breaking changes.`);
  }
}

// Re-export the pure helpers for downstream tooling (MCP could use these too).
export { buildSnapshot, diffSnapshots, formatChanges };
export type { ContractSnapshot } from '../lib/contract-snapshot';
