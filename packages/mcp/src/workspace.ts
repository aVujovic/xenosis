import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

/**
 * Minimal workspace discovery — a port of packages/cli/src/lib/workspace.ts so
 * the MCP server stays independent of @xenosisorg/xenosis-cli at runtime. Keep
 * in sync; the field set is small and stable.
 */

export interface WorkspaceConfig {
  scope: string;
  defaults: { orm: 'prisma'; port: number; transport: 'http' };
  structure: {
    apis: string;
    schemas: string;
    services: string;
    sharedModules: string;
  };
  sharedModules: string[];
}

const DEFAULTS: WorkspaceConfig = {
  scope: '@myorg',
  defaults: { orm: 'prisma', port: 4000, transport: 'http' },
  structure: {
    apis: 'packages/apis',
    schemas: 'packages/db-schemas',
    services: 'services',
    sharedModules: 'packages/shared-modules',
  },
  sharedModules: [],
};

const WORKSPACE_FILENAME = 'xenosis.workspace.json';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Walks up from `start` looking for `xenosis.workspace.json`. */
export async function findWorkspaceRoot(start = process.cwd()): Promise<string | null> {
  let current = resolve(start);
  while (true) {
    if (await exists(resolve(current, WORKSPACE_FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function readWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
  const raw = await readFile(resolve(root, WORKSPACE_FILENAME), 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    ...DEFAULTS,
    ...parsed,
    defaults: { ...DEFAULTS.defaults, ...(parsed.defaults ?? {}) },
    structure: { ...DEFAULTS.structure, ...(parsed.structure ?? {}) },
    sharedModules: Array.isArray(parsed.sharedModules) ? parsed.sharedModules : [],
  };
}
