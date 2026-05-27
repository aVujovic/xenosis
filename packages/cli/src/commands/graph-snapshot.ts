import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import pc from 'picocolors';
import { requireWorkspace } from '../lib/workspace';
import { log } from '../lib/log';
import { buildSnapshot, serializeSnapshot } from '../lib/contract-snapshot';

const DEFAULT_PATH = '.xenosis/contract.json';

interface Opts {
  flags: Record<string, string | boolean>;
}

/**
 * `xenosis graph snapshot` — writes a frozen JSON view of the workspace's
 * peer contract to `.xenosis/contract.json`. Commit the file; on a PR,
 * `xenosis graph diff` compares the current source against the committed
 * snapshot and exits non-zero on breaking changes.
 */
export async function runGraphSnapshot({ flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();
  const out = typeof flags.out === 'string' ? flags.out : DEFAULT_PATH;
  const outPath = resolve(root, out);

  const snapshot = await buildSnapshot(root, config.structure.services);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeSnapshot(snapshot), 'utf-8');

  const routeCount = snapshot.services.reduce((acc, s) => acc + s.routes.length, 0);
  log.ok(`Wrote contract snapshot to ${pc.cyan(out)}`);
  log.hint(
    `${snapshot.services.length} service${snapshot.services.length === 1 ? '' : 's'}, ` +
      `${routeCount} peer route${routeCount === 1 ? '' : 's'}.`,
  );
  log.blank();
  log.hint('Next: commit the file. On PRs, run `xenosis graph diff <base-branch>` to gate breaking changes.');
}
