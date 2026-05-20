import { resolve, join } from 'node:path';
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

export async function runCreateApi({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  const isExternal = flags.external === true;
  clack.intro(`Create ${isExternal ? 'an external' : 'an internal'} peer API`);

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: isExternal ? 'External API name (e.g. stripe)?' : 'Peer name (e.g. billing)?',
      placeholder: isExternal ? 'stripe' : 'billing',
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
  const packageName = scopedApiName(scope, name);
  const dirName = apiDir(name);

  const baseDir = isExternal
    ? join(config.structure.apis, 'xenosis-custom')
    : config.structure.apis;
  const dest = resolve(root, baseDir, dirName);

  if (await exists(dest)) {
    throw new Error(`API directory already exists: ${dest}`);
  }

  const tokens = {
    packageName,
    nameKebab: name,
    nameCamel: toCamel(name),
    apiCamel: toCamel(name) + 'Api',
    ApiPascal: toPascal(name) + 'Api',
  };

  const templateName = isExternal ? 'api-external' : 'api-internal';

  const s = clack.spinner();
  s.start(`Scaffolding ${packageName}`);
  const written = await copyTemplate(templateName, dest, tokens);
  s.stop(`Created ${written.length} files at ${baseDir}/${dirName}/`);

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 ${packageName} ready.`,
      ``,
      isExternal
        ? `Next: add custom headers + baseUrl in consumer service xenosis.config.json under "peers.${tokens.nameCamel}".`
        : `Next:`,
      isExternal
        ? ``
        : `  Provider (the service that implements ${tokens.apiCamel}):`,
      isExternal
        ? ``
        : `    mountPeerApi(server, ${tokens.apiCamel}, { ping: (input) => yourService.ping(input) });`,
      ``,
      `  Consumer (any service that calls this peer):`,
      `    "peers": {`,
      `      "${tokens.nameCamel}": {`,
      `        "package": "${packageName}",`,
      `        "transport": "http",`,
      `        "baseUrl": "${isExternal ? 'https://api.example.com' : 'http://localhost:4000'}"`,
      isExternal ? `        , "headers": { "Authorization": "Bearer ..." }` : ``,
      `      }`,
      `    }`,
    ].filter(Boolean).join('\n'),
  );
}
