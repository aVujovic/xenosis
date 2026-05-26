import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireWorkspace } from '../lib/workspace';
import { log } from '../lib/log';

/**
 * `xenosis init mcp` — drops a project-scope .mcp.json that points AI clients
 * (Claude Code, Claude Desktop, Cursor, …) at @xenosisorg/xenosis-mcp. The
 * file is committed to git so the whole team picks it up on clone.
 *
 * Also called inline from `create app` when the user opts in there.
 */

interface Opts {
  flags?: Record<string, string | boolean>;
}

/** The block we inject — same shape every client expects. */
const XENOSIS_SERVER = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@xenosisorg/xenosis-mcp'],
} as const;

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Outcome of writing — useful for the create-app caller to message correctly. */
export type InitMcpResult =
  | { action: 'created'; path: string }
  | { action: 'merged'; path: string }
  | { action: 'already-configured'; path: string };

/**
 * Pure-ish: takes a workspace root, writes/merges `.mcp.json`, returns what
 * happened. Used by both the CLI command and create-app's inline flow.
 */
export async function writeMcpConfig(root: string): Promise<InitMcpResult> {
  const path = resolve(root, '.mcp.json');

  if (!(await exists(path))) {
    const fresh: McpConfig = { mcpServers: { xenosis: XENOSIS_SERVER } };
    await writeFile(path, JSON.stringify(fresh, null, 2) + '\n', 'utf-8');
    return { action: 'created', path };
  }

  // File exists — parse + merge so a user's other MCP servers survive.
  let existing: McpConfig;
  try {
    const raw = await readFile(path, 'utf-8');
    existing = JSON.parse(raw) as McpConfig;
  } catch (err) {
    throw new Error(
      `${path} exists but is not valid JSON (${(err as Error).message}). ` +
        `Fix or remove it, then re-run.`,
    );
  }

  if (existing.mcpServers?.xenosis) {
    return { action: 'already-configured', path };
  }

  const next: McpConfig = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), xenosis: XENOSIS_SERVER },
  };
  await writeFile(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return { action: 'merged', path };
}

export async function runInitMcp(_opts: Opts = {}): Promise<void> {
  const { root } = await requireWorkspace();
  const result = await writeMcpConfig(root);

  switch (result.action) {
    case 'created':
      log.ok(`Created ${result.path}`);
      break;
    case 'merged':
      log.ok(`Added xenosis server to existing ${result.path}`);
      break;
    case 'already-configured':
      log.warn(`xenosis is already configured in ${result.path} — nothing to do.`);
      return;
  }

  log.blank();
  log.hint('Next steps:');
  log.hint('  • Commit .mcp.json so your team gets MCP on clone.');
  log.hint(
    '  • Restart your AI client (Claude Code / Cursor / Claude Desktop). ' +
      'Most clients prompt to trust new project-scope MCP servers on first load.',
  );
  log.hint('  • Try in chat: "list the MCP tools available from xenosis".');
}
