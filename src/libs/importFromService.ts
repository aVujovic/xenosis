import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Read the default ESM entry from an `exports` field. */
function pickExportEntry(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField;
  if (!exportsField || typeof exportsField !== 'object') return undefined;
  const map = exportsField as Record<string, any>;
  const root = map['.'] ?? map;
  if (typeof root === 'string') return root;
  if (typeof root !== 'object' || root === null) return undefined;
  const r = root as Record<string, any>;
  return (
    (typeof r.source === 'string' && r.source) ||
    (typeof r.import === 'string' && r.import) ||
    (typeof r.default === 'string' && r.default) ||
    (typeof r.module === 'string' && r.module) ||
    undefined
  );
}

/**
 * Imports a package by walking up from the consumer service's CWD looking for
 * `<node_modules>/<pkgName>/package.json`. Works even when `@xenosisorg/xenosis-core`'s
 * own source tree doesn't depend on the package — which is always the case
 * for user-land schemas, peer APIs, and shared modules.
 *
 * Once the package directory is found, the function reads its `exports` /
 * `module` / `main` field and `import()`s the matching file via a `file://`
 * URL so Node's ESM loader honours the package's exports map.
 */
export async function importFromService(pkgName: string): Promise<any> {
  let current = process.cwd();
  while (true) {
    const candidate = resolve(current, 'node_modules', pkgName, 'package.json');
    if (await exists(candidate)) {
      const pkg = JSON.parse(await readFile(candidate, 'utf-8'));
      const pkgDir = dirname(candidate);
      const entry =
        pickExportEntry(pkg.exports) ??
        (typeof pkg.module === 'string' ? pkg.module : undefined) ??
        (typeof pkg.main === 'string' ? pkg.main : undefined) ??
        'index.js';
      const entryAbs = resolve(pkgDir, entry);
      return import(pathToFileURL(entryAbs).href);
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Cannot find package '${pkgName}' imported from ${process.cwd()}`,
      );
    }
    current = parent;
  }
}
