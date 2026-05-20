import { resolve, join, basename } from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { sync as globSync } from 'glob';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { validateName, toPascal } from '../lib/pkgname';

interface Opts {
  name?: string;
  flags: Record<string, string | boolean>;
}

interface PeerRoute {
  /** `@peer <methodName>` from JSDoc */
  method: string;
  /** HTTP verb */
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full path including the controller's `server.use('/base', router)` prefix */
  path: string;
  /** Source location for diagnostics */
  source: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a single controller for `@peer` annotations.
 *
 * The expected pattern is:
 *
 *   /** @peer createCharge *\/
 *   router.route('/').post(Handler(...));
 *
 * For the service-wide path prefix we look for `server.use('/api/v1/<base>', router)`
 * at the bottom of the file. If multiple `server.use()` calls exist, we take
 * the last one — that's the convention every Xenosis controller follows.
 */
function parseController(source: string, filePath: string): PeerRoute[] {
  const out: PeerRoute[] = [];

  // 1. Locate the base path: server.use('<prefix>', router)
  const useRegex = /server\s*\.\s*use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*router\s*\)/g;
  let basePath = '';
  let useMatch: RegExpExecArray | null;
  while ((useMatch = useRegex.exec(source)) !== null) {
    basePath = useMatch[1] ?? '';
  }

  // 2. Find every JSDoc block containing `@peer <name>`, followed by a
  //    `router.route('<sub>').<verb>(...)` invocation. The JSDoc can be
  //    multiline so we use `[\s\S]*?` rather than `[^*]*?` — the latter
  //    would refuse to traverse the `*` characters that JSDoc puts on
  //    every continuation line.
  const peerRegex =
    /\/\*\*[\s\S]*?@peer\s+(\w+)[\s\S]*?\*\/\s*router\s*\.\s*route\s*\(\s*['"`]([^'"`]*)['"`]\s*\)\s*\.\s*(get|post|put|patch|delete)\s*\(/gi;

  let m: RegExpExecArray | null;
  while ((m = peerRegex.exec(source)) !== null) {
    const methodName = m[1]!;
    const subPath = m[2] ?? '';
    const verb = (m[3] ?? '').toUpperCase() as PeerRoute['httpMethod'];
    const full = joinPath(basePath, subPath);
    out.push({
      method: methodName,
      httpMethod: verb,
      path: full,
      source: filePath,
    });
  }

  return out;
}

function joinPath(base: string, sub: string): string {
  if (!sub || sub === '/') return base || '/';
  if (!base) return sub.startsWith('/') ? sub : `/${sub}`;
  const a = base.replace(/\/+$/, '');
  const b = sub.startsWith('/') ? sub : `/${sub}`;
  return `${a}${b}`;
}

/**
 * Render the routes object literal. Returns lines (without the surrounding
 * `routes: { ... }` keys — those live inside the template below).
 */
function renderRoutes(routes: PeerRoute[]): string {
  if (routes.length === 0) {
    return '    // No @peer annotations found in controllers.';
  }
  const maxName = Math.max(...routes.map((r) => r.method.length));
  const maxVerb = Math.max(...routes.map((r) => r.httpMethod.length));
  return routes
    .map((r) => {
      const namePad = r.method.padEnd(maxName);
      const verbQ = `'${r.httpMethod}',`;
      const verbPad = verbQ.padEnd(maxVerb + 4);
      return `    ${namePad}: { method: ${verbPad} path: '${r.path}' },`;
    })
    .join('\n');
}

/**
 * Replace the `routes: { ... }` block inside an existing `defineServiceApi`
 * call, leaving the rest of the file (types, imports, comments) untouched.
 */
function spliceRoutesBlock(source: string, rendered: string): string | null {
  // Match `routes: {` (allow whitespace), then capture body until matching `}`.
  // Then we recognise where the block ends by counting braces forward.
  const start = source.search(/routes\s*:\s*\{/);
  if (start < 0) return null;
  const openIdx = source.indexOf('{', start);
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  // i is one past the matching `}`. Replace [openIdx, i) with new block.
  return `${source.slice(0, openIdx)}{\n${rendered}\n  }${source.slice(i)}`;
}

function defaultApiTemplate(serviceName: string, rendered: string): string {
  const pascal = toPascal(serviceName);
  return `import { defineServiceApi } from '@xenosisorg/xenosis-core';

/**
 * ${serviceName}-service public API surface — generated and kept in sync
 * by \`xenosis sync api ${serviceName}\`. Add \`@peer <methodName>\` to a
 * controller route's JSDoc to surface it here.
 *
 * Types below are scaffolded placeholders — replace with the real input
 * and output shapes for each method.
 */

export type ${pascal}ServiceApi = {
  // TODO: declare each @peer method's input/output here.
};

export default defineServiceApi<${pascal}ServiceApi>({
  name: '${serviceName}',
  routes: {
${rendered}
  },
});
`;
}

export async function runSyncApi({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Sync service API package from controllers');

  let serviceName = positional;
  if (!serviceName) {
    const ans = await clack.text({
      message: 'Service name?',
      placeholder: 'users',
      validate: (v) => validateName(v) ?? undefined,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    serviceName = ans as string;
  } else {
    const err = validateName(serviceName);
    if (err) throw new Error(err);
  }

  // Service directory: <workspaceRoot>/<services>/<name>-service
  const serviceDir = resolve(root, config.structure.services, `${serviceName}-service`);
  if (!(await exists(serviceDir))) {
    throw new Error(`Service not found: ${serviceDir}`);
  }

  // 1. Scan controllers.
  const controllerGlob = join(serviceDir, 'src/api/**/*.controller.ts');
  const controllers = globSync(controllerGlob);
  if (controllers.length === 0) {
    clack.cancel(`No controllers found under ${controllerGlob}`);
    process.exit(1);
  }

  const allRoutes: PeerRoute[] = [];
  for (const file of controllers) {
    const text = await readFile(file, 'utf-8');
    const routes = parseController(text, file);
    allRoutes.push(...routes);
  }

  // Sort by name for deterministic output.
  allRoutes.sort((a, b) => a.method.localeCompare(b.method));

  if (allRoutes.length === 0) {
    clack.log.warn(
      'No `@peer <name>` annotations found in any controller. Add JSDoc like ' +
        '`/** @peer createUser */` above the route to expose it through the ' +
        'service API package.',
    );
  } else {
    clack.log.info(
      `Found ${allRoutes.length} @peer route(s): ${allRoutes.map((r) => r.method).join(', ')}`,
    );
  }

  // 2. Bootstrap the apis/<name>-api package if it doesn't exist.
  const apiDir = resolve(root, config.structure.apis, `${serviceName}-api`);
  const apiSrcDir = join(apiDir, 'src');
  const apiIndex = join(apiSrcDir, 'index.ts');
  const apiPkg = join(apiDir, 'package.json');
  const scope = config.scope;

  const rendered = renderRoutes(allRoutes);

  if (!(await exists(apiDir))) {
    await mkdir(apiSrcDir, { recursive: true });
    await writeFile(
      apiPkg,
      JSON.stringify(
        {
          name: `${scope}/${serviceName}-api`,
          version: '0.0.1',
          private: true,
          type: 'module',
          main: 'src/index.ts',
          types: 'src/index.ts',
          exports: {
            '.': {
              source: './src/index.ts',
              import: './src/index.ts',
              types: './src/index.ts',
            },
          },
          dependencies: {
            '@xenosisorg/xenosis-core': 'workspace:*',
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    await writeFile(apiIndex, defaultApiTemplate(serviceName, rendered), 'utf-8');
    clack.outro(
      [
        `🎉 Created ${scope}/${serviceName}-api with ${allRoutes.length} route(s).`,
        ``,
        `  Add input/output types to ${config.structure.apis}/${serviceName}-api/src/index.ts`,
        `  Re-run \`xenosis sync api ${serviceName}\` after adding new @peer routes.`,
      ].join('\n'),
    );
    return;
  }

  // 3. Splice routes into the existing index.ts.
  const existing = await readFile(apiIndex, 'utf-8');
  const next = spliceRoutesBlock(existing, rendered);
  if (next === null) {
    throw new Error(
      `Could not locate \`routes: { ... }\` block in ${apiIndex}. ` +
        `Ensure the file calls \`defineServiceApi({ ..., routes: { ... } })\`.`,
    );
  }

  if (next === existing) {
    clack.outro(`✅ ${scope}/${serviceName}-api already up to date.`);
    return;
  }

  await writeFile(apiIndex, next, 'utf-8');
  clack.outro(
    [
      `🎉 Updated ${scope}/${serviceName}-api with ${allRoutes.length} route(s).`,
      ``,
      `  Type contract: ${config.structure.apis}/${serviceName}-api/src/index.ts`,
      `  Sample sources:`,
      ...controllers.map((c) => `    ${basename(c)} (${c.replace(root + '/', '')})`),
    ].join('\n'),
  );
}
