import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { copyTemplate } from '../lib/template';
import { scopedApiName, apiDir, validateName, toCamel, toPascal } from '../lib/pkgname';
import { pnpmInstall } from '../lib/install';

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

/**
 * `xenosis create socket-api <name>` — scaffold a `@scope/<name>-socket-api`
 * package. Mirrors `create-api` (the REST/peer counterpart) but the
 * template produces a `defineSocketApi(...)` default export instead of
 * `defineServiceApi(...)`. The package becomes the typed contract shared
 * between the WS handler (`src/sockets/<name>.socket.ts`) and any peer
 * service that uses `socketBus` to broadcast outbound messages.
 *
 * Directory layout matches the other internal API packages: lives under
 * `<structure.apis>/<name>-socket-api/`.
 */
export async function runCreateSocketApi({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Create a socket API package');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Socket name (e.g. chat)?',
      placeholder: 'chat',
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

  const scope = typeof flags.scope === 'string' ? flags.scope : config.scope;
  // Socket API packages get a `-socket` suffix on the directory so they
  // don't collide with a same-named REST peer API in the same workspace.
  // E.g. `chat-api` (REST peers) + `chat-socket-api` (WebSocket).
  const baseName = `${name}-socket`;
  const packageName = scopedApiName(scope, baseName);
  const dirName = apiDir(baseName);
  const dest = resolve(root, config.structure.apis, dirName);

  if (await exists(dest)) {
    throw new Error(`Socket API directory already exists: ${dest}`);
  }

  const tokens = {
    packageName,
    nameKebab: name,
    nameCamel: toCamel(name),
    apiCamel: toCamel(name) + 'Socket',
    ApiPascal: toPascal(name),
  };

  const s = clack.spinner();
  s.start(`Scaffolding ${packageName}`);
  const written = await copyTemplate('socket-api', dest, tokens);
  s.stop(`Created ${written.length} files at ${config.structure.apis}/${dirName}/`);

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 ${packageName} ready.`,
      ``,
      `Wire it into a service:`,
      `  // services/${tokens.nameKebab}-service/xenosis.config.json`,
      `  "sockets": {`,
      `    "${tokens.nameCamel}": {`,
      `      "package": "${packageName}",`,
      `      "transport": "ws",`,
      `      "requireAuth": true`,
      `    }`,
      `  }`,
      ``,
      `Then drop a handler at src/sockets/${tokens.nameKebab}.socket.ts and start the service.`,
    ].join('\n'),
  );
}
