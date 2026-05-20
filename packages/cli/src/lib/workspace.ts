import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export interface WorkspaceConfig {
  scope: string;
  defaults: {
    orm: 'prisma';
    port: number;
    transport: 'http';
  };
  structure: {
    apis: string;
    schemas: string;
    services: string;
    sharedModules: string;
  };
  /**
   * npm package names of shared modules loaded into the cradle of every
   * service in this workspace (e.g. whitelabel, feature-flags).
   */
  sharedModules: string[];
}

export const DEFAULT_WORKSPACE: WorkspaceConfig = {
  scope: '@myorg',
  defaults: {
    orm: 'prisma',
    port: 4000,
    transport: 'http',
  },
  structure: {
    apis: 'packages/apis',
    schemas: 'packages/db-schemas',
    services: 'services',
    sharedModules: 'packages/shared-modules',
  },
  sharedModules: [],
};

export const WORKSPACE_FILENAME = 'xenosis.workspace.json';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks up from cwd looking for `xenosis.workspace.json`. Returns the absolute
 * path of the workspace root (the directory containing the file).
 */
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
    ...DEFAULT_WORKSPACE,
    ...parsed,
    defaults: { ...DEFAULT_WORKSPACE.defaults, ...(parsed.defaults ?? {}) },
    structure: { ...DEFAULT_WORKSPACE.structure, ...(parsed.structure ?? {}) },
    sharedModules: Array.isArray(parsed.sharedModules) ? parsed.sharedModules : [],
  };
}

export async function writeWorkspaceConfig(root: string, config: WorkspaceConfig): Promise<void> {
  await writeFile(
    resolve(root, WORKSPACE_FILENAME),
    JSON.stringify(config, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Loads the workspace config — fails loudly if we're not inside a Xenosis monorepo.
 */
export async function requireWorkspace(): Promise<{ root: string; config: WorkspaceConfig }> {
  const root = await findWorkspaceRoot();
  if (!root) {
    throw new Error(
      `No xenosis.workspace.json found in this directory or any parent. ` +
        `Run \`npx create-xenosis-app <name>\` to bootstrap a new project, ` +
        `or \`cd\` into an existing one.`,
    );
  }
  const config = await readWorkspaceConfig(root);
  return { root, config };
}
