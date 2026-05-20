import { asClass, AwilixContainer, Lifetime, type LifetimeType } from 'awilix';
import { sync as globSync } from 'glob';
import { minimatch } from 'minimatch';
import { workerData } from 'node:worker_threads';
import path from 'node:path';
import url from 'node:url';
import { existsSync } from 'node:fs';
import type {
  AutoloadEntry,
  AutoloadLifetime,
  AutoloadOptions,
  AutoloadStyle,
  ILogger,
  XenosisFileMeta,
} from '../types';

/**
 * Lazily-loaded manifest produced by `xenosis generate manifest`. When
 * present at `<cwd>/src/.xenosis-manifest.{ts,js}` it is used INSTEAD of
 * runtime glob, so a bundled service (where the glob cannot enumerate
 * files at runtime) still resolves every autoloaded module.
 *
 * The manifest exports `__xenosisManifest` — a map from glob-matched file
 * path to a thunk returning the dynamic import. Static `() => import('...')`
 * is bundler-friendly.
 */
type Manifest = Record<string, () => Promise<unknown>>;
let manifestCache: Manifest | null | undefined; // undefined = not probed yet

async function loadManifest(cwd: string): Promise<Manifest | null> {
  if (manifestCache !== undefined) return manifestCache;
  for (const ext of ['ts', 'js', 'mjs']) {
    const candidate = path.join(cwd, 'src', `.xenosis-manifest.${ext}`);
    if (existsSync(candidate)) {
      const mod = (await import(url.pathToFileURL(candidate).href)) as {
        __xenosisManifest?: Manifest;
      };
      manifestCache = mod.__xenosisManifest ?? null;
      return manifestCache;
    }
  }
  manifestCache = null;
  return null;
}

interface ResolvedEntry {
  category: string;
  pattern: string | string[];
  lifetime: AutoloadLifetime;
  style: AutoloadStyle;
}

interface LoadedModule {
  category: string;
  modulePath: string;
  relativePath: string;
  ctor: any;
  meta: XenosisFileMeta;
  defaultLifetime: AutoloadLifetime;
  style: AutoloadStyle;
}

const LIFETIME_MAP: Record<AutoloadLifetime, LifetimeType> = {
  singleton: Lifetime.SINGLETON,
  scoped: Lifetime.SCOPED,
  transient: Lifetime.TRANSIENT,
};

/**
 * Convert a filename like `User.repository.ts` into a cradle key `userRepository`.
 * Strict: filename MUST end with `.<category>.{ts,js,mjs,cjs}`. The category
 * suffix is dropped and the remaining base is lower-camelCased + appended.
 *
 * Examples (category = 'repository'):
 *   User.repository.ts            → userRepository
 *   UserAccount.repository.ts     → userAccountRepository
 *   stripe.service.ts             → stripeService (category = 'service')
 */
function deriveCradleKey(filename: string, category: string): string | null {
  const stripped = filename.replace(/\.(ts|js|mjs|cjs)$/i, '');
  const suffix = `.${category}`;
  if (!stripped.toLowerCase().endsWith(suffix.toLowerCase())) {
    return null;
  }
  const base = stripped.slice(0, stripped.length - suffix.length);
  if (!base) return null;
  // Lower-camelCase the base, then append the category as a suffix word.
  const camelBase = base.charAt(0).toLowerCase() + base.slice(1);
  const capitalCategory = category.charAt(0).toUpperCase() + category.slice(1);
  return `${camelBase}${capitalCategory}`;
}

/**
 * Singularize a category key so it matches the filename suffix convention.
 * Examples:
 *   repositories → repository
 *   services     → service
 *   controllers  → controller
 *   middlewares  → middleware
 *   jobs         → job
 * Single-word keys without trailing 's' are returned as-is.
 */
function categoryToSuffix(category: string): string {
  if (category.endsWith('ies') && category.length > 3) {
    return category.slice(0, -3) + 'y';
  }
  if (category.endsWith('s') && category.length > 1) {
    return category.slice(0, -1);
  }
  return category;
}

function normalizeEntry(category: string, entry: AutoloadEntry): ResolvedEntry {
  const defaultStyle: AutoloadStyle = category === 'controllers' ? 'build' : 'class';
  return {
    category,
    pattern: entry.pattern,
    lifetime: entry.lifetime ?? 'singleton',
    style: entry.style ?? defaultStyle,
  };
}

function resolveCwd(): string {
  return (
    (workerData as { cwd?: string } | undefined)?.cwd ?? process.cwd()
  );
}

async function loadCategory(
  resolved: ResolvedEntry,
  logger: ILogger,
): Promise<LoadedModule[]> {
  const cwd = resolveCwd();
  const patterns = Array.isArray(resolved.pattern)
    ? resolved.pattern
    : [resolved.pattern];

  // Manifest mode — if `xenosis generate manifest` was run, prefer the
  // statically-imported map over runtime glob. Required for production
  // bundlers (tsup, esbuild) that can't enumerate files at runtime.
  const manifest = await loadManifest(cwd);

  // Module loader closes over manifest/glob decision so the rest of the
  // function stays uniform.
  type MatchEntry = { absPath: string; relPath: string; import: () => Promise<any> };
  let matches: MatchEntry[];

  if (manifest) {
    matches = Object.entries(manifest)
      .filter(([file]) => patterns.some((p) => minimatch(file, p)))
      .map(([file, importer]) => ({
        absPath: path.resolve(cwd, file),
        relPath: file,
        import: importer as () => Promise<any>,
      }));
  } else {
    const matchedPaths = patterns
      .flatMap((p) => globSync(path.isAbsolute(p) ? p : path.join(cwd, p)))
      .filter((p, i, arr) => arr.indexOf(p) === i);
    matches = matchedPaths.map((abs) => ({
      absPath: abs,
      relPath: path.relative(cwd, abs),
      import: () => import(url.pathToFileURL(abs).href),
    }));
  }

  if (matches.length === 0) {
    logger.warn(
      `[xenosis/autoload] pattern ${JSON.stringify(resolved.pattern)} matched 0 files (category=${resolved.category}${manifest ? ', via manifest' : ''})`,
    );
    return [];
  }

  const suffix = categoryToSuffix(resolved.category);
  const loaded: LoadedModule[] = [];

  for (const m of matches) {
    const modulePath = m.absPath;
    const relativePath = m.relPath;
    const filename = path.basename(modulePath);

    // Validate naming convention up-front so users get a clear error.
    const cradleKey = deriveCradleKey(filename, suffix);
    if (!cradleKey && resolved.style === 'class') {
      throw new Error(
        `[xenosis/autoload] ${relativePath}: filename must match *.${suffix}.{ts,js} ` +
          `(set __xenosis.skip = true to silence)`,
      );
    }

    const mod = (await m.import()) as {
      default?: any;
      __xenosis?: XenosisFileMeta;
    };

    if (!mod.default) {
      throw new Error(
        `[xenosis/autoload] ${relativePath}: missing default export ` +
          `(autoload registers default export only)`,
      );
    }

    const meta: XenosisFileMeta = mod.__xenosis ?? {};
    if (meta.skip) {
      logger.info(`[xenosis/autoload] skip ${relativePath} (__xenosis.skip = true)`);
      continue;
    }

    loaded.push({
      category: resolved.category,
      modulePath,
      relativePath,
      ctor: mod.default,
      meta,
      defaultLifetime: resolved.lifetime,
      style: resolved.style,
    });
  }

  return loaded;
}

/**
 * Drives autoload — globs each category, dynamically imports matched files,
 * validates them, and registers/builds them in the awilix container.
 *
 * Order:
 *   1. all `style: 'class'` entries are registered first, across all categories
 *      (so repositories can satisfy services regardless of category order)
 *   2. all `style: 'build'` entries (e.g. controllers) run last via container.build,
 *      after every class is in the cradle
 */
export async function runAutoload(
  container: AwilixContainer,
  options: AutoloadOptions,
  logger: ILogger,
): Promise<void> {
  const resolved: ResolvedEntry[] = Object.entries(options).map(
    ([category, entry]) => normalizeEntry(category, entry),
  );

  const allLoaded: LoadedModule[] = [];
  for (const entry of resolved) {
    const loaded = await loadCategory(entry, logger);
    allLoaded.push(...loaded);
  }

  // 1. Register class entries.
  for (const mod of allLoaded.filter((m) => m.style === 'class')) {
    const cradleKey =
      mod.meta.name ?? deriveCradleKey(path.basename(mod.modulePath), categoryToSuffix(mod.category));
    if (!cradleKey) {
      throw new Error(
        `[xenosis/autoload] ${mod.relativePath}: could not derive cradle key — ` +
          `set __xenosis.name explicitly`,
      );
    }
    const lifetime: AutoloadLifetime = mod.meta.lifetime ?? mod.defaultLifetime;

    container.register({
      [cradleKey]: asClass(mod.ctor, { lifetime: LIFETIME_MAP[lifetime] }),
    });

    logger.info(
      `[xenosis/autoload] register ${cradleKey} ← ${mod.relativePath} (${lifetime})`,
    );
  }

  // 2. Build entries (e.g. controllers) — must run after all class entries
  // are registered so their cradle dependencies resolve.
  for (const mod of allLoaded.filter((m) => m.style === 'build')) {
    container.build(mod.ctor);
    logger.info(
      `[xenosis/autoload] build ${mod.relativePath}`,
    );
  }
}
