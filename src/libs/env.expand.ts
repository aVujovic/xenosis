/**
 * Expand `$env:NAME` placeholders in a loaded config tree against `process.env`
 * (or any string→string map). Runs ONCE during config load, before zod
 * validation — so the schema validates the final, env-resolved shape.
 *
 * Three placeholder forms are supported:
 *
 *   "$env:JWT_SECRET"            → process.env.JWT_SECRET, or undefined when missing
 *   "$env:PORT:-4000"            → process.env.PORT, or the literal "4000" when missing
 *   "$env:STRIPE_KEY:?required"  → process.env.STRIPE_KEY, or throw with a clear message
 *
 * Placement matters:
 *
 *   - A value that IS a placeholder (the whole string starts with `$env:`):
 *     replaced by the env value as-is, with light coercion (numeric string →
 *     number, "true"/"false" → boolean, "null" → null). Coercion lets
 *     `"$env:PORT:-4000"` satisfy a `z.number()` schema field.
 *
 *   - A value that CONTAINS a placeholder (e.g. `"redis://$env:REDIS_PASS@host:6379"`):
 *     the placeholder is substituted inline; the surrounding string stays a
 *     string. No coercion. A missing optional placeholder substitutes the
 *     empty string.
 *
 * Recursion walks objects and arrays. Symbol keys are ignored.
 */

const PLACEHOLDER_RE =
  /\$env:([A-Z_][A-Z0-9_]*)(?::([-?])([^"]*?))?/g;
//      ^ name             ^ op    ^ default / "required" marker

const WHOLE_PLACEHOLDER_RE =
  /^\$env:([A-Z_][A-Z0-9_]*)(?::([-?])(.*))?$/;

export interface ExpandOptions {
  env?: Record<string, string | undefined>;
}

export function expandEnvPlaceholders<T>(value: T, opts: ExpandOptions = {}): T {
  const env = opts.env ?? process.env;
  return expand(value, env, '') as T;
}

function expand(
  value: unknown,
  env: Record<string, string | undefined>,
  path: string,
): unknown {
  if (typeof value === 'string') {
    return expandString(value, env, path);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => expand(v, env, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expand(v, env, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

function expandString(
  raw: string,
  env: Record<string, string | undefined>,
  path: string,
): unknown {
  // Whole-value placeholder: replace and coerce.
  const whole = WHOLE_PLACEHOLDER_RE.exec(raw);
  if (whole) {
    const [, name, op, rest] = whole;
    const envValue = env[name!];

    if (envValue !== undefined && envValue !== '') {
      return coerce(envValue);
    }

    // Missing: handle :- default and :? required.
    if (op === '-') {
      return coerce(rest ?? '');
    }
    if (op === '?') {
      const reason = rest && rest.length > 0 ? `: ${rest}` : '';
      throw new Error(
        `[xenosis/config] required env variable "${name}" is not set (referenced by ${path || '(root)'})${reason}`,
      );
    }

    // No default, not required: leave as undefined so zod can report a
    // precise "Required" error at the right path, matching today's behaviour
    // when a key is missing from the config file.
    return undefined;
  }

  // String interpolation: substitute placeholders inside a larger string.
  let hadRequiredFailure: { name: string; reason: string } | undefined;
  const replaced = raw.replace(PLACEHOLDER_RE, (_match, name: string, op?: string, rest?: string) => {
    const envValue = env[name];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (op === '-') {
      return rest ?? '';
    }
    if (op === '?') {
      hadRequiredFailure = { name, reason: rest && rest.length > 0 ? `: ${rest}` : '' };
      return '';
    }
    return '';
  });

  if (hadRequiredFailure) {
    throw new Error(
      `[xenosis/config] required env variable "${hadRequiredFailure.name}" is not set (referenced by ${path || '(root)'})${hadRequiredFailure.reason}`,
    );
  }

  return replaced;
}

/**
 * Light type coercion for whole-value placeholder substitution. Keeps the
 * schema's job (real validation) but lets `"$env:PORT"` satisfy a number field
 * and `"$env:CORS_OK:-true"` satisfy a boolean.
 */
function coerce(s: string): unknown {
  if (s === '') return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}
