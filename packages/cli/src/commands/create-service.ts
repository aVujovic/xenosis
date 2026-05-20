import { resolve } from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { copyTemplate } from '../lib/template';
import { serviceName, serviceDir, validateName, toCamel, toPascal } from '../lib/pkgname';
import { pnpmInstall } from '../lib/install';
import { log } from '../lib/log';

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
 * Increments the workspace defaults.port by 1 and writes back. Returns the
 * port that was assigned to the new service.
 */
async function reservePort(rootPath: string): Promise<number> {
  const cfgPath = resolve(rootPath, 'xenosis.workspace.json');
  const raw = await readFile(cfgPath, 'utf-8');
  const cfg = JSON.parse(raw);
  const current = cfg.defaults?.port ?? 4000;
  cfg.defaults = { ...(cfg.defaults ?? {}), port: current + 1 };
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  return current;
}

export async function runCreateService({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Create a Xenosis service');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Service name?',
      placeholder: 'users',
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

  const svcName = serviceName(name);
  const dirName = serviceDir(name);
  const dest = resolve(root, config.structure.services, dirName);

  if (await exists(dest)) {
    throw new Error(`Service directory already exists: ${dest}`);
  }

  const port = typeof flags.port === 'string'
    ? Number(flags.port)
    : await reservePort(root);

  const tokens = {
    serviceName: svcName,
    nameKebab: name,
    nameCamel: toCamel(name),
    NamePascal: toPascal(name),
    port: String(port),
    appScope: config.scope,
  };

  // --lang flag: ts (default) | js. The 'js' variant uses the parallel
  // service-js template (plain JavaScript + JSDoc types). Both templates take
  // the same token shape.
  const lang = typeof flags.lang === 'string' ? flags.lang.toLowerCase() : 'ts';
  if (lang !== 'ts' && lang !== 'js') {
    throw new Error(`Unknown --lang "${lang}". Use "ts" or "js".`);
  }
  const templateName = lang === 'js' ? 'service-js' : 'service';

  const s = clack.spinner();
  s.start(`Scaffolding ${svcName} (${lang})`);
  const written = await copyTemplate(templateName, dest, tokens);
  s.stop(`Created ${written.length} files at ${config.structure.services}/${dirName}/`);

  // Wire every workspace-level shared module into the new service's deps.
  // Without this, the core's sharedModules loader would fail to import them
  // because pnpm wouldn't have linked the packages into this service.
  if (config.sharedModules.length > 0) {
    const pkgPath = resolve(dest, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    pkg.dependencies = pkg.dependencies ?? {};
    for (const sharedPkg of config.sharedModules) {
      if (!pkg.dependencies[sharedPkg]) {
        pkg.dependencies[sharedPkg] = 'workspace:*';
      }
    }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  }

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 ${svcName} ready on port ${port}.`,
      ``,
      `  pnpm --filter ${svcName} dev`,
      ``,
      `  curl http://localhost:${port}/healthcheck`,
      `  curl http://localhost:${port}/api/v1/example`,
    ].join('\n'),
  );
}
