import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AwilixContainer } from 'awilix';
import type { ILogger, SharedModule } from '../types';

const WORKSPACE_FILENAME = 'xenosis.workspace.json';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Imports a package by walking up the service's directory tree looking for
 * <node_modules>/<pkgName>/package.json — this works even when @xenosisorg/xenosis-core's
 * own source tree doesn't depend on the package (which is always the case
 * for user-land shared modules).
 *
 * Once the package directory is found, we read its `main` / `exports` /
 * `module` field and `import()` the matching file via a file:// URL so
 * Node's ESM loader honors the package's exports map.
 */
async function importFromService(pkgName: string): Promise<any> {
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
 * Walk up from cwd looking for `xenosis.workspace.json` and return its
 * `sharedModules` array. Returns an empty array when there is no workspace
 * config (services that aren't part of a Xenosis monorepo just skip the step).
 */
async function readSharedModulesList(): Promise<string[]> {
  let current = process.cwd();
  while (true) {
    const candidate = resolve(current, WORKSPACE_FILENAME);
    if (await exists(candidate)) {
      try {
        const raw = await readFile(candidate, 'utf-8');
        const parsed = JSON.parse(raw);
        const list = parsed?.sharedModules;
        if (Array.isArray(list)) {
          return list.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        // Malformed workspace config: silently fall back to no modules.
      }
      return [];
    }
    const parent = dirname(current);
    if (parent === current) return [];
    current = parent;
  }
}

/**
 * Resolve a SharedModule from a dynamically imported package.
 * Accepts:
 *   - default-export of a SharedModule object
 *   - named `module` export of a SharedModule object
 *   - the module object itself directly attached to the namespace
 */
function pickSharedModule(mod: any, pkgName: string): SharedModule {
  const candidate =
    (mod && typeof mod.default === 'object' && mod.default) ||
    (mod && typeof mod.module === 'object' && mod.module) ||
    (mod && typeof mod.register === 'function' && mod);

  if (!candidate || typeof candidate.register !== 'function') {
    throw new Error(
      `[xenosis/shared-modules] Package "${pkgName}" must default-export a SharedModule ` +
        `(an object with at least a register(container) function).`,
    );
  }
  return candidate as SharedModule;
}

/**
 * Reads `xenosis.workspace.json` → `sharedModules`, dynamically imports each
 * package, registers them in the awilix container, and awaits their optional
 * `init(cradle)` hooks before returning.
 *
 * Modules are independent — registration order matches the array order.
 * `init` is called in array order; throwing aborts boot.
 */
export async function loadSharedModules(
  container: AwilixContainer,
  logger: ILogger,
): Promise<SharedModule[]> {
  const list = await readSharedModulesList();
  if (list.length === 0) return [];

  const loaded: SharedModule[] = [];

  for (const pkgName of list) {
    let raw: any;
    try {
      raw = await importFromService(pkgName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[xenosis/shared-modules] Failed to import "${pkgName}": ${msg}. ` +
          `Make sure the package is installed in this service.`,
      );
    }

    const mod = pickSharedModule(raw, pkgName);
    mod.register(container);
    logger.info(
      `🧩 Shared module registered: ${mod.name ?? pkgName} ← ${pkgName}`,
    );
    loaded.push(mod);
  }

  // Phase 2: async init AFTER every module is registered, so an init() callback
  // can resolve another module's cradle entry if it wants to.
  for (const mod of loaded) {
    if (typeof mod.init === 'function') {
      try {
        await mod.init(container.cradle);
        logger.info(`🧩 Shared module initialised: ${mod.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[xenosis/shared-modules] ${mod.name}.init() failed: ${msg}`,
        );
      }
    }
  }

  return loaded;
}
