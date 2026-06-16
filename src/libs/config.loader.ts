import path from 'node:path';
import url from 'node:url';
import { existsSync } from 'node:fs';
import { workerData } from 'node:worker_threads';
import type { ZodType } from 'zod';
import { xenosisConfigSchema, type XenosisConfig } from '../config.schema';
import { expandEnvPlaceholders } from './env.expand';

/**
 * Validate the loaded config against the Xenosis schema, fail-fast at boot.
 *
 * If the service ships `src/config.schema.{ts,js}` default-exporting an extended
 * schema (via `defineConfigSchema`), that schema is used instead of the base —
 * so the service's own config keys are type-checked too. Otherwise the base
 * `xenosisConfigSchema` (passthrough) applies, validating known keys and
 * leaving unknown ones intact.
 *
 * On failure the process aborts with a precise message (which key, what was
 * expected) rather than letting an invalid value surface deep inside a loader.
 */
export async function validateConfig(config: unknown): Promise<XenosisConfig> {
  const schema = (await loadUserSchema()) ?? xenosisConfigSchema;

  // Expand `$env:NAME` placeholders BEFORE validation so the schema validates
  // the final, env-resolved shape. See src/libs/env.expand.ts for the supported
  // placeholder forms ($env:NAME, $env:NAME:-default, $env:NAME:?required).
  const expanded = expandEnvPlaceholders(config);

  const result = schema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Runs before the logger exists (the logger depends on the validated
    // config), so abort with a plain error — the message lands on stderr.
    throw new Error(
      `[xenosis] Invalid xenosis.config.json:\n${issues}\n` +
        `Fix the config (or your src/config.schema.ts) and restart.`,
    );
  }

  const parsed = result.data as XenosisConfig;

  // env fallback: if the config doesn't set `env`, take it from NODE_ENV when
  // it's one of the recognised values. Lets a single image switch modes by env
  // var (e.g. NODE_ENV=production → JSON logs) without editing the config file.
  if (!parsed.env) {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'production' || nodeEnv === 'staging' || nodeEnv === 'development') {
      parsed.env = nodeEnv;
    }
  }

  return parsed;
}

function resolveCwd(): string {
  return (workerData as { cwd?: string } | undefined)?.cwd ?? process.cwd();
}

/**
 * Look for `<cwd>/src/config.schema.{ts,js,mjs}` and return its default-exported
 * schema if present. Returns null when the service hasn't declared one.
 */
async function loadUserSchema(): Promise<ZodType | null> {
  const cwd = resolveCwd();
  for (const ext of ['ts', 'js', 'mjs']) {
    const candidate = path.join(cwd, 'src', `config.schema.${ext}`);
    if (!existsSync(candidate)) continue;
    const mod = (await import(url.pathToFileURL(candidate).href)) as {
      default?: ZodType;
    };
    if (mod.default && typeof (mod.default as ZodType).safeParse === 'function') {
      return mod.default;
    }
  }
  return null;
}
