import { resolve, join, basename } from 'node:path';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import pc from 'picocolors';
import { log } from '../lib/log';

interface Opts {
  /** Optional service path (defaults to cwd). */
  name?: string;
  flags: Record<string, string | boolean>;
}

type Framework = 'express' | 'hono';

const HONO_VERSION = '^4.6.0';
const HONO_NODE_SERVER_VERSION = '^1.13.0';

/**
 * `xenosis migrate http --to <framework>`
 *
 * Switches a Xenosis service between Express and Hono adapters:
 *   - sets `http.framework` in xenosis.config.json
 *   - adds (or removes) `hono` + `@hono/node-server` in package.json
 *   - scans controllers for raw Express patterns that won't survive Hono
 *     and prints them as "manual review needed"
 *
 * Reversible: `--to express` removes the flag + deps.
 */
export async function runMigrateHttp(opts: Opts): Promise<void> {
  const toRaw = (opts.flags.to ?? opts.flags.framework) as string | undefined;
  if (toRaw !== 'express' && toRaw !== 'hono') {
    log.err(
      `Missing or invalid --to. Use:  ${pc.cyan('xenosis migrate http --to express')}  or  ${pc.cyan('xenosis migrate http --to hono')}`,
    );
    process.exitCode = 1;
    return;
  }
  const to: Framework = toRaw;

  const cwd = opts.name ? resolve(process.cwd(), opts.name) : process.cwd();

  const configPath = join(cwd, 'xenosis.config.json');
  const pkgPath = join(cwd, 'package.json');

  const config = await readJson(configPath);
  if (!config) {
    log.err(`No xenosis.config.json found at ${pc.dim(configPath)}`);
    process.exitCode = 1;
    return;
  }
  const pkg = await readJson(pkgPath);
  if (!pkg) {
    log.err(`No package.json found at ${pc.dim(pkgPath)}`);
    process.exitCode = 1;
    return;
  }

  const from: Framework = (config.http?.framework as Framework | undefined) ?? 'express';
  if (from === to) {
    log.warn(`Service is already on ${pc.bold(to)}. Nothing to do.`);
    return;
  }

  log.info(`Migrating ${pc.bold(pkg.name ?? basename(cwd))}: ${pc.dim(from)} → ${pc.bold(to)}`);

  // 1. Update xenosis.config.json
  if (to === 'hono') {
    config.http = { ...(config.http ?? {}), framework: 'hono' };
  } else {
    if (config.http) {
      delete config.http.framework;
      if (Object.keys(config.http).length === 0) delete config.http;
    }
  }
  await writeJson(configPath, config);
  log.ok(`Updated ${pc.dim('xenosis.config.json')}: ${to === 'hono' ? 'set' : 'removed'} http.framework`);

  // 2. Update package.json deps
  pkg.dependencies = pkg.dependencies ?? {};
  if (to === 'hono') {
    pkg.dependencies.hono = pkg.dependencies.hono ?? HONO_VERSION;
    pkg.dependencies['@hono/node-server'] =
      pkg.dependencies['@hono/node-server'] ?? HONO_NODE_SERVER_VERSION;
  } else {
    delete pkg.dependencies.hono;
    delete pkg.dependencies['@hono/node-server'];
    if (Object.keys(pkg.dependencies).length === 0) delete pkg.dependencies;
  }
  await writeJson(pkgPath, pkg);
  log.ok(
    `Updated ${pc.dim('package.json')}: ${
      to === 'hono'
        ? 'added hono + @hono/node-server'
        : 'removed hono + @hono/node-server'
    }`,
  );

  // 3. Scan controllers for patterns that may need manual review on Hono.
  if (to === 'hono') {
    const flagged = await scanForExpressOnlyPatterns(join(cwd, 'src'));
    if (flagged.length > 0) {
      log.warn(`Found ${flagged.length} location(s) using Express-specific APIs that may not work on Hono:`);
      for (const { file, line, snippet, hint } of flagged) {
        console.log(`  ${pc.yellow(file)}:${pc.bold(String(line))}  ${pc.dim(snippet)}`);
        console.log(`    ${pc.dim('→')} ${hint}`);
      }
      console.log('');
      log.info(
        `Review the flagged lines. See ${pc.cyan('MIGRATION_express_to_hono.md')} for the supported subset.`,
      );
    } else {
      log.ok('No Express-specific API usage detected in src/.');
    }
  }

  console.log('');
  log.info(`Next:  ${pc.cyan('pnpm install')}  →  ${pc.cyan('pnpm dev')}`);
}

async function readJson(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

interface Finding {
  file: string;
  line: number;
  snippet: string;
  hint: string;
}

/**
 * Walk `src/` and flag uses of Express-specific helpers that have no direct
 * Hono equivalent through the XReq/XRes abstraction. These don't break the
 * build — they're just signal that the developer should sanity-check.
 */
async function scanForExpressOnlyPatterns(root: string): Promise<Finding[]> {
  const findings: Finding[] = [];

  const PATTERNS: Array<{ re: RegExp; hint: string }> = [
    { re: /\bres\.type\s*\(/, hint: "use res.setHeader('content-type', '…') instead of res.type(…)" },
    { re: /\bres\.cookie\s*\(/, hint: 'res.cookie() is Express-only; set a Set-Cookie header explicitly' },
    { re: /\bres\.format\s*\(/, hint: 'res.format() (content negotiation) is Express-only' },
    { re: /\bres\.render\s*\(/, hint: 'res.render() (view engine) is Express-only' },
    { re: /\bres\.sendFile\s*\(/, hint: 'res.sendFile() is Express-only; stream via res.raw or use a Hono-native helper' },
    { re: /\breq\.accepts\s*\(/, hint: 'req.accepts() is Express-only; parse Accept header manually' },
    { re: /\breq\.get\s*\(/, hint: "use req.header('…') instead of req.get('…')" },
    { re: /\breq\.cookies\b/, hint: 'req.cookies is Express middleware-driven; parse the cookie header explicitly' },
    { re: /from\s+['"]express['"]/, hint: "remove this import — XReq/XRes types come from '@xenosisorg/xenosis-core'" },
  ];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      const st = await stat(p);
      if (st.isDirectory()) {
        if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
        await walk(p);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e)) {
        const content = await readFile(p, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          for (const { re, hint } of PATTERNS) {
            if (re.test(line)) {
              findings.push({
                file: p,
                line: i + 1,
                snippet: line.trim().slice(0, 120),
                hint,
              });
            }
          }
        }
      }
    }
  }

  await walk(root);
  return findings;
}
