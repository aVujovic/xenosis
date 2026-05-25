import { resolve } from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { copyTemplatePaths } from '../lib/template';
import { serviceName, serviceDir, validateName } from '../lib/pkgname';
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

/** Test devDeps + script grafted onto an existing service. */
const TEST_DEV_DEPS: Record<string, string> = {
  '@xenosisorg/xenosis-testing': '^0.0.1',
  supertest: '^7.0.0',
  vitest: '^4.0.0',
};
const TS_DEV_DEPS: Record<string, string> = { '@types/supertest': '^6.0.2' };

/**
 * Graft the `__tests__/` scaffold (setup + example test + test.config.json) and
 * a vitest.config onto an EXISTING service — the same files `create service`
 * now emits for new ones. For services created before the testing kit existed.
 */
export async function runCreateTest({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Add the test scaffold to a service');

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

  if (!(await exists(dest))) {
    throw new Error(`Service not found: ${config.structure.services}/${dirName}`);
  }
  if (await exists(resolve(dest, '__tests__'))) {
    throw new Error(`${dirName} already has a __tests__ directory — nothing to do.`);
  }

  // Detect language from the existing service (service.ts vs service.js).
  const isJs = await exists(resolve(dest, 'src/service.js'));
  const template = isJs ? 'service-js' : 'service';
  const ext = isJs ? 'js' : 'ts';

  const tokens = { serviceName: svcName, nameKebab: name };

  const s = clack.spinner();
  s.start(`Scaffolding tests for ${svcName} (${ext})`);
  const written = await copyTemplatePaths(
    template,
    ['__tests__', `vitest.config.${ext}`],
    dest,
    tokens,
  );
  s.stop(`Created ${written.length} file(s) under ${config.structure.services}/${dirName}/`);

  // Add the test script + devDeps to the service's package.json.
  const pkgPath = resolve(dest, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.test) pkg.scripts.test = 'vitest run';
  pkg.devDependencies = pkg.devDependencies ?? {};
  const deps = { ...TEST_DEV_DEPS, ...(isJs ? {} : TS_DEV_DEPS) };
  for (const [dep, ver] of Object.entries(deps)) {
    if (!pkg.devDependencies[dep]) pkg.devDependencies[dep] = ver;
  }
  pkg.devDependencies = Object.fromEntries(
    Object.entries(pkg.devDependencies).sort(),
  );
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 Tests ready for ${svcName}.`,
      ``,
      `  pnpm --filter ${svcName} test`,
      ``,
      `  Edit __tests__/setup.ts to add default peer mocks, and`,
      `  __tests__/test.config.json for test-only config overrides.`,
    ].join('\n'),
  );
}
