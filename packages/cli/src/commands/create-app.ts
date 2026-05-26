import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { copyTemplate } from '../lib/template';
import { validateName } from '../lib/pkgname';
import { log } from '../lib/log';
import { writeMcpConfig } from './init-mcp';

interface Opts {
  name?: string;
  flags: Record<string, string | boolean>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runCreateApp({ name: positional, flags }: Opts): Promise<void> {
  clack.intro('Create a new Xenosis monorepo');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Project directory name?',
      placeholder: 'my-platform',
      validate: (v) => validateName(v) ?? undefined,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    name = ans as string;
  } else {
    const err = validateName(name);
    if (err) throw new Error(err);
  }

  const dest = resolve(process.cwd(), name);
  if (await exists(dest)) {
    throw new Error(`Directory ${name} already exists. Choose another name or remove it.`);
  }

  // Scope prompt
  let scope = typeof flags.scope === 'string' ? flags.scope : undefined;
  if (!scope) {
    const ans = await clack.text({
      message: 'npm scope for generated packages?',
      placeholder: '@myorg',
      initialValue: '@myorg',
      validate: (v) => {
        if (!v) return 'Required.';
        if (!v.startsWith('@')) return 'Must start with @ (e.g. @myorg).';
        return undefined;
      },
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    scope = ans as string;
  }

  const port = typeof flags.port === 'string' ? Number(flags.port) : 4000;

  // Structure paths (could be prompted; for now use sensible defaults).
  const apisDir = 'packages/apis';
  const schemasDir = 'packages/db-schemas';
  const sharedModulesDir = 'packages/shared-modules';
  const servicesDir = 'services';

  const tokens = {
    appName: name,
    scope,
    port: String(port),
    apisDir,
    schemasDir,
    sharedModulesDir,
    servicesDir,
  };

  const s = clack.spinner();
  s.start(`Creating ${name}/`);
  const written = await copyTemplate('app', dest, tokens);
  s.stop(`Created ${written.length} files in ${name}/`);

  // ── MCP integration ──────────────────────────────────────────────────────
  // Drop .mcp.json so AI clients (Claude Code / Cursor / Claude Desktop) get
  // workspace-aware tools out of the box. Opt-out via --no-mcp; non-interactive
  // yes via --mcp.
  let enableMcp: boolean;
  if (flags['no-mcp']) {
    enableMcp = false;
  } else if (flags.mcp) {
    enableMcp = true;
  } else {
    const ans = await clack.confirm({
      message:
        'Enable AI assistant integration via MCP? Drops a .mcp.json so Claude / Cursor / etc. get workspace-aware tools.',
      initialValue: true,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    enableMcp = ans as boolean;
  }

  if (enableMcp) {
    try {
      await writeMcpConfig(dest);
    } catch (err) {
      // Don't fail the whole scaffold over MCP — it's an optional add-on.
      log.warn(`Couldn't write .mcp.json: ${(err as Error).message}`);
      log.hint('You can retry later with `xenosis init mcp`.');
    }
  }

  clack.outro(
    [
      `🎉 ${name} is ready.`,
      ``,
      `  cd ${name}`,
      `  pnpm install`,
      ``,
      `  xenosis create schema psql-main`,
      `  xenosis create api billing`,
      `  xenosis create service users`,
      `  xenosis dev`,
    ].join('\n'),
  );
}
