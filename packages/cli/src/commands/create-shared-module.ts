import { resolve, join } from 'node:path';
import { access, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import {
  requireWorkspace,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from '../lib/workspace';
import { copyTemplate } from '../lib/template';
import {
  scopedSharedModuleName,
  sharedModuleDir,
  validateName,
  toCamel,
  toPascal,
} from '../lib/pkgname';
import { pnpmInstall } from '../lib/install';

interface Opts {
  name?: string;
  flags: Record<string, string | boolean>;
}

type Lifetime = 'singleton' | 'scoped' | 'transient';
type Style = 'class' | 'function';

function asLifetime(v: string | boolean | undefined): Lifetime {
  if (typeof v !== 'string') return 'singleton';
  if (['singleton', 'scoped', 'transient'].includes(v)) return v as Lifetime;
  throw new Error(
    `Unknown --lifetime value "${v}". Allowed: singleton, scoped, transient`,
  );
}

function asStyle(v: string | boolean | undefined): Style {
  if (typeof v !== 'string') return 'class';
  if (['class', 'function'].includes(v)) return v as Style;
  throw new Error(`Unknown --style value "${v}". Allowed: class, function`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runCreateSharedModule({
  name: positional,
  flags,
}: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Create a shared module');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Module name?',
      placeholder: 'whitelabel',
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

  const lifetime = asLifetime(flags.lifetime);
  const style = asStyle(flags.style);

  const scope =
    typeof flags.scope === 'string' ? flags.scope : config.scope;
  const packageName = scopedSharedModuleName(scope, name);
  const dirName = sharedModuleDir(name);
  const dest = resolve(root, config.structure.sharedModules, dirName);

  if (await exists(dest)) {
    throw new Error(`Shared module directory already exists: ${dest}`);
  }

  const tokens = {
    packageName,
    nameKebab: name,
    nameCamel: toCamel(name),
    NamePascal: toPascal(name),
    lifetime,
  };

  const lang = typeof flags.lang === 'string' ? flags.lang.toLowerCase() : 'ts';
  if (lang !== 'ts' && lang !== 'js') {
    throw new Error(`Unknown --lang "${lang}". Use "ts" or "js".`);
  }
  const langSuffix = lang === 'js' ? '-js' : '';

  const templateName =
    style === 'function'
      ? `shared-module${langSuffix}-function`
      : `shared-module${langSuffix}-class`;

  const s = clack.spinner();
  s.start(`Scaffolding ${packageName} (${lang}, ${style}, ${lifetime})`);
  const written = await copyTemplate(templateName, dest, tokens);
  s.stop(
    `Created ${written.length} files at ${config.structure.sharedModules}/${dirName}/`,
  );

  // Auto-register in xenosis.workspace.json so every service in the workspace
  // picks it up at boot.
  const fresh = await readWorkspaceConfig(root);
  if (!fresh.sharedModules.includes(packageName)) {
    fresh.sharedModules.push(packageName);
    await writeWorkspaceConfig(root, fresh);
    clack.log.info(`Added "${packageName}" to xenosis.workspace.json → sharedModules`);
  }

  // Add the new shared module as a workspace dep in EVERY existing service so
  // pnpm links it into each service's node_modules. Without this the core's
  // sharedModules loader would fail to import the package from a service.
  const wired = await wireIntoServices(root, config.structure.services, packageName);
  if (wired.length > 0) {
    clack.log.info(
      `Added "${packageName}" to ${wired.length} service${wired.length === 1 ? '' : 's'}: ${wired.join(', ')}`,
    );
  }

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 ${packageName} ready (${style}, ${lifetime}).`,
      ``,
      `It's now in the cradle of every service in this workspace as:`,
      `  cradle.${tokens.nameCamel}`,
      ``,
      `Use it from a service:`,
      `  import type { ${tokens.NamePascal} } from '${packageName}';`,
      `  constructor(deps: { ${tokens.nameCamel}: ${tokens.NamePascal} }) {}`,
      ``,
      `Edit the implementation:`,
      `  ${config.structure.sharedModules}/${dirName}/src/${style === 'class' ? `${tokens.NamePascal}.${lang}` : `${tokens.nameCamel}.factory.${lang}`}`,
    ].join('\n'),
  );
}

/**
 * Walks every service directory under `structure.services` and adds the
 * shared module package as a `workspace:*` dependency. Idempotent.
 */
async function wireIntoServices(
  root: string,
  servicesDir: string,
  packageName: string,
): Promise<string[]> {
  const base = resolve(root, servicesDir);
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }

  const wired: string[] = [];
  for (const entry of entries) {
    const svcDir = join(base, entry);
    let s;
    try {
      s = await stat(svcDir);
    } catch { continue; }
    if (!s.isDirectory()) continue;

    const pkgPath = join(svcDir, 'package.json');
    let pkg: any;
    try {
      pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    } catch { continue; }
    if (!pkg.name) continue;

    pkg.dependencies = pkg.dependencies ?? {};
    if (pkg.dependencies[packageName]) continue;

    pkg.dependencies[packageName] = 'workspace:*';
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    wired.push(pkg.name);
  }
  return wired;
}
