import { readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Resolve the effective test config for a service.
 *
 * Base is the service's real `xenosis.config.json` (single source of structure:
 * which schemas, peers, boundaries it has). Over it we layer
 * `__tests__/test.config.json` — a DELTA holding only what a test needs to
 * change (e.g. disable auth, point a schema at a test connector). Both files are
 * optional; the test delta wins on conflicts.
 *
 * The delta may name a different base via `extends` (relative to the test file).
 */
export async function resolveTestConfig(serviceRoot: string): Promise<Record<string, any>> {
  const base = await readJson(join(serviceRoot, 'xenosis.config.json'));

  const testCfgPath = join(serviceRoot, '__tests__', 'test.config.json');
  const delta = await readJson(testCfgPath);

  let resolvedBase = base;
  if (delta.extends) {
    const extendsPath = isAbsolute(delta.extends)
      ? delta.extends
      : resolve(serviceRoot, '__tests__', delta.extends);
    resolvedBase = await readJson(extendsPath);
  }

  const { extends: _drop, ...deltaRest } = delta;
  return mergeConfig(resolvedBase, deltaRest);
}

async function readJson(path: string): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Shallow-merge per top-level key, with one level of merge for the object
 * blocks (connectors/schemas/peers/boundaries/authentication). Arrays and
 * scalars are replaced wholesale by the delta.
 */
function mergeConfig(
  base: Record<string, any>,
  delta: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = { ...base[k], ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}
