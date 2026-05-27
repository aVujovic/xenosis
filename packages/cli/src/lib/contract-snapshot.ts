import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { sync as globSync } from 'glob';

/**
 * Contract snapshot — a deterministic JSON view of every peer-facing route in
 * the workspace, including content hashes for the inline zod schemas that
 * gate the request and (when present) shape the response. Two snapshots
 * (e.g. main vs. feature branch) can be diffed to surface breaking changes
 * before they reach the integration runtime.
 *
 * Design choices:
 *   • Source-of-truth is the controller file. Schemas live as inline `const
 *     <Name>Schema = z.object({...})` declarations next to the route that
 *     uses them — same convention every Xenosis service already follows.
 *   • We hash the literal *source* of each schema declaration. Brittle?
 *     Slightly: a whitespace-only edit changes the hash and trips a diff.
 *     But every edit that matters (added required field, removed field,
 *     changed type, renamed key) trips it too, so the false-positive rate
 *     in the "edit the schema" direction is zero. The runtime alternative
 *     (boot every service, dump OpenAPI, hash JSON Schema) was rejected
 *     because the CI use-case can't depend on services running.
 *   • Only @peer-annotated routes are included. Public REST endpoints that
 *     aren't on the peer surface are out of scope — they don't break
 *     sibling services.
 */

/** Wire-protocol version of the snapshot JSON. */
export const CONTRACT_SCHEMA_VERSION = 1;

export interface SnapshotRoute {
  /** Peer method name from `@peer <name>` JSDoc directive. */
  method: string;
  /** HTTP verb (uppercase). */
  httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Resolved full path with the controller's server.use() prefix applied. */
  path: string;
  /** SHA-256 of the request body / params / query schema source, or null if none. */
  bodySchemaHash: string | null;
  /** SHA-256 of the response schema source, or null if not declared (`.returns()` is optional). */
  responseSchemaHash: string | null;
  /** Names of zod consts referenced inside the route's `Handler(...)`. Useful for human diffs. */
  schemaNames: string[];
}

export interface SnapshotService {
  /** Service identity — peerName ?? config.name ?? dir. */
  name: string;
  /** Optional explicit boundary list at snapshot time. */
  allowedCallers: string[] | undefined;
  /** Sorted by `${httpMethod} ${path}` for stable diffs. */
  routes: SnapshotRoute[];
}

export interface ContractSnapshot {
  __schema_version: typeof CONTRACT_SCHEMA_VERSION;
  /** ISO timestamp the snapshot was generated. Excluded from comparisons. */
  generatedAt: string;
  /** Sorted by name for stable diffs. */
  services: SnapshotService[];
}

/* ─── Generation ─────────────────────────────────────────────────────── */

/**
 * Build a snapshot from the workspace. Pure (apart from fs reads) — does
 * not boot any service, does not require ports, can run in CI on a fresh
 * checkout.
 */
export async function buildSnapshot(
  workspaceRoot: string,
  servicesDir: string,
): Promise<ContractSnapshot> {
  const configPaths = globSync(`${servicesDir}/*/xenosis.config.json`, {
    cwd: workspaceRoot,
    absolute: true,
  }).sort();

  const services: SnapshotService[] = [];

  for (const cfgPath of configPaths) {
    let cfg: {
      name?: string;
      peerName?: string;
      boundaries?: { allowedCallers?: string[] };
    };
    try {
      cfg = JSON.parse(await readFile(cfgPath, 'utf-8'));
    } catch {
      continue;
    }
    const name = cfg.peerName ?? cfg.name ?? basename(dirname(cfgPath));
    const serviceDir = dirname(cfgPath);

    const controllers = globSync('src/api/**/*.controller.{ts,js}', {
      cwd: serviceDir,
      absolute: true,
    }).sort();

    const routes: SnapshotRoute[] = [];
    for (const controllerPath of controllers) {
      const source = await readFile(controllerPath, 'utf-8');
      routes.push(...extractRoutes(source));
    }
    routes.sort((a, b) => `${a.httpMethod} ${a.path}`.localeCompare(`${b.httpMethod} ${b.path}`));

    services.push({
      name,
      allowedCallers: cfg.boundaries?.allowedCallers,
      routes,
    });
  }

  services.sort((a, b) => a.name.localeCompare(b.name));

  return {
    __schema_version: CONTRACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    services,
  };
}

/**
 * Parse one controller file. Mirrors the parsing strategy in sync-api.ts
 * (`@peer` JSDoc + `router.route(...).verb(...)`) and additionally scans
 * the Handler() argument list for the names of zod schema constants — then
 * resolves those names against `const X = z....` declarations in the same
 * file and hashes their source.
 *
 * Exported for unit testing.
 */
export function extractRoutes(source: string): SnapshotRoute[] {
  const basePath = findBasePath(source);
  const schemaSources = collectSchemaSources(source);

  const out: SnapshotRoute[] = [];

  // Greedy match across the JSDoc → router.route().verb(...) → Handler(...) chain.
  // We need the Handler call's full argument list to know which schema names
  // it references; route handlers can span several lines, so we read until
  // the closing paren that balances the Handler('s opening one.
  const peerRegex =
    /\/\*\*[\s\S]*?@peer\s+(\w+)[\s\S]*?\*\/\s*router\s*\.\s*route\s*\(\s*['"`]([^'"`]*)['"`]\s*\)\s*\.\s*(get|post|put|patch|delete)\s*\(([\s\S]*)/gi;

  let m: RegExpExecArray | null;
  while ((m = peerRegex.exec(source)) !== null) {
    const methodName = m[1]!;
    const subPath = m[2] ?? '';
    const verb = (m[3] ?? '').toUpperCase() as SnapshotRoute['httpMethod'];
    const tail = m[4] ?? '';

    // Read the route's call arguments until we balance the verb-call paren.
    const verbCallArgs = readBalanced(tail, '(', ')');
    // Within those args, find the Handler(...) call and read its arguments.
    const handlerOpen = verbCallArgs.indexOf('Handler(');
    let handlerArgs = '';
    if (handlerOpen >= 0) {
      const after = verbCallArgs.slice(handlerOpen + 'Handler('.length);
      handlerArgs = readBalanced(after, '(', ')');
    }

    const schemaNames = extractSchemaNames(handlerArgs);
    const responseName = extractReturnsName(verbCallArgs);

    const bodyOrParamSchemas = schemaNames
      .map((n) => schemaSources.get(n))
      .filter((s): s is string => s !== undefined);
    const responseSchemaSrc = responseName ? schemaSources.get(responseName) : undefined;

    out.push({
      method: methodName,
      httpMethod: verb,
      path: joinPath(basePath, subPath),
      bodySchemaHash:
        bodyOrParamSchemas.length === 0
          ? null
          : sha256(bodyOrParamSchemas.join('\n')),
      responseSchemaHash: responseSchemaSrc ? sha256(responseSchemaSrc) : null,
      schemaNames: [...schemaNames, ...(responseName ? [responseName] : [])],
    });
  }

  return out;
}

function findBasePath(source: string): string {
  const re = /server\s*\.\s*use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*router\s*\)/g;
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) last = m[1] ?? '';
  return last;
}

function joinPath(base: string, sub: string): string {
  if (!sub || sub === '/') return base || '/';
  if (!base) return sub.startsWith('/') ? sub : `/${sub}`;
  const a = base.replace(/\/+$/, '');
  const b = sub.startsWith('/') ? sub : `/${sub}`;
  return `${a}${b}`;
}

/**
 * Find every `const <Name>Schema = z.<...>;` (or `= z....` followed by a
 * top-level `;` once paren/brace depth returns to zero) and remember the
 * exact source slice — that slice is what we hash.
 */
function collectSchemaSources(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:^|\n)\s*const\s+(\w+)\s*=\s*z\./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1]!;
    // Start of the value expression: position of `z.` minus the rest of
    // line content already consumed by `m[0]`. Easier: locate `z.` after m.index.
    const start = source.indexOf('z.', m.index);
    if (start < 0) continue;
    const end = findExpressionEnd(source, start);
    const slice = source.slice(start, end).trim();
    out.set(name, slice);
  }
  return out;
}

/**
 * Walk forward from `start`, tracking paren / bracket / brace depth, and
 * stop at the first `;` or newline that lands at depth zero. Skip over
 * string and template literals so a `;` inside `"x;y"` doesn't fool us.
 */
function findExpressionEnd(src: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i]!;
    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && (ch === ';' || ch === '\n')) {
      // For multi-line declarations, only break on newline if the next
      // non-whitespace isn't a method continuation like `.optional()`.
      if (ch === '\n') {
        let j = i + 1;
        while (j < src.length && /\s/.test(src[j]!)) j++;
        if (src[j] === '.') {
          i++;
          continue;
        }
      }
      return i;
    }
    i++;
  }
  return src.length;
}

/**
 * Read a balanced delimited slice starting from text whose first occurrence
 * of `open` is already accounted for (i.e. text begins *after* the opener).
 * Returns the slice up to (but not including) the matching `close`. Skips
 * string literals.
 */
function readBalanced(text: string, open: string, close: string): string {
  let depth = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(0, i);
    }
    i++;
  }
  return text; // unbalanced — return what we have rather than throwing
}

/** Extract the schema constant names referenced inside `Handler(...)` args. */
function extractSchemaNames(handlerArgs: string): string[] {
  // We look for Request.Body(<name>), Request.Params(<name>), Request.Query(<name>),
  // Request.Headers(<name>). The names should match `<word>Schema` by convention
  // but we don't enforce — anything passed inside is fair game.
  const names: string[] = [];
  const re = /Request\.(?:Body|Params|Query|Headers)\s*\(\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(handlerArgs)) !== null) names.push(m[1]!);
  return names;
}

/** Extract the response schema name from a `.returns(<name>)` call. */
function extractReturnsName(callArgs: string): string | null {
  const m = /\.returns\s*\(\s*(\w+)/.exec(callArgs);
  return m ? m[1]! : null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16);
}

/* ─── Diffing ───────────────────────────────────────────────────────── */

export type ChangeKind =
  | 'route-added'         // additive — non-breaking
  | 'route-removed'       // breaking — callers will fail
  | 'request-changed'     // potentially breaking — flag for review
  | 'response-changed'    // potentially breaking — flag for review
  | 'caller-added'        // additive — boundary widened
  | 'caller-removed'      // breaking — caller now refused
  | 'boundary-opened'     // additive — list deleted (open to all)
  | 'boundary-closed';    // potentially breaking — list introduced

export interface ContractChange {
  service: string;
  kind: ChangeKind;
  /** Human description. */
  detail: string;
  /** True when CI should fail. Additive changes are false. */
  breaking: boolean;
  /** Optional context — e.g. the route key when relevant. */
  route?: string;
}

/**
 * Compare two snapshots. Returns a list of changes sorted with breaking
 * changes first, then by service name.
 *
 * Semantics:
 *   • Route removed   → BREAKING (callers calling that method will 5xx).
 *   • Request hash changed → BREAKING (added required field is the common case;
 *     we can't tell additive from breaking from a hash alone, so we flag it
 *     and let the reviewer confirm).
 *   • Response hash changed → BREAKING (existing fields might be gone).
 *   • Route added     → additive (no existing caller depends on it).
 *   • allowedCallers — caller removed is breaking, added or removed-entirely
 *     is additive.
 */
export function diffSnapshots(
  base: ContractSnapshot,
  next: ContractSnapshot,
): ContractChange[] {
  const out: ContractChange[] = [];
  const baseByName = new Map(base.services.map((s) => [s.name, s]));
  const nextByName = new Map(next.services.map((s) => [s.name, s]));

  // Services: route-by-route diff
  for (const [name, baseSvc] of baseByName) {
    const nextSvc = nextByName.get(name);
    if (!nextSvc) {
      // Whole service gone — every route is a removal.
      for (const r of baseSvc.routes) {
        out.push({
          service: name,
          kind: 'route-removed',
          breaking: true,
          route: `${r.httpMethod} ${r.path}`,
          detail: `service "${name}" was removed; route ${r.httpMethod} ${r.path} (${r.method}) no longer exists`,
        });
      }
      continue;
    }
    out.push(...diffService(baseSvc, nextSvc));
  }
  // New services — additive
  for (const [name, nextSvc] of nextByName) {
    if (baseByName.has(name)) continue;
    for (const r of nextSvc.routes) {
      out.push({
        service: name,
        kind: 'route-added',
        breaking: false,
        route: `${r.httpMethod} ${r.path}`,
        detail: `new service "${name}" exposes ${r.httpMethod} ${r.path} (${r.method})`,
      });
    }
  }

  // Sort: breaking first, then service, then route.
  out.sort((a, b) => {
    if (a.breaking !== b.breaking) return a.breaking ? -1 : 1;
    if (a.service !== b.service) return a.service.localeCompare(b.service);
    return (a.route ?? '').localeCompare(b.route ?? '');
  });
  return out;
}

function diffService(base: SnapshotService, next: SnapshotService): ContractChange[] {
  const out: ContractChange[] = [];

  // Boundary changes
  const baseAllow = base.allowedCallers;
  const nextAllow = next.allowedCallers;
  if (baseAllow && !nextAllow) {
    out.push({
      service: base.name,
      kind: 'boundary-opened',
      breaking: false,
      detail: `allowedCallers list removed — service is now open to all callers`,
    });
  } else if (!baseAllow && nextAllow) {
    out.push({
      service: base.name,
      kind: 'boundary-closed',
      breaking: true,
      detail: `allowedCallers list introduced — was open, now restricted to [${nextAllow.join(', ')}]`,
    });
  } else if (baseAllow && nextAllow) {
    const baseSet = new Set(baseAllow);
    const nextSet = new Set(nextAllow);
    for (const c of baseAllow) {
      if (!nextSet.has(c)) {
        out.push({
          service: base.name,
          kind: 'caller-removed',
          breaking: true,
          detail: `caller "${c}" removed from allowedCallers (was permitted, now refused with 403)`,
        });
      }
    }
    for (const c of nextAllow) {
      if (!baseSet.has(c)) {
        out.push({
          service: base.name,
          kind: 'caller-added',
          breaking: false,
          detail: `caller "${c}" added to allowedCallers`,
        });
      }
    }
  }

  // Route diff
  const keyOf = (r: SnapshotRoute) => `${r.httpMethod} ${r.path}`;
  const baseRoutes = new Map(base.routes.map((r) => [keyOf(r), r]));
  const nextRoutes = new Map(next.routes.map((r) => [keyOf(r), r]));

  for (const [key, baseR] of baseRoutes) {
    const nextR = nextRoutes.get(key);
    if (!nextR) {
      out.push({
        service: base.name,
        kind: 'route-removed',
        breaking: true,
        route: key,
        detail: `route ${key} (peer method "${baseR.method}") removed`,
      });
      continue;
    }
    if (baseR.bodySchemaHash !== nextR.bodySchemaHash) {
      out.push({
        service: base.name,
        kind: 'request-changed',
        breaking: true,
        route: key,
        detail: `request schema changed (callers may need to update their input shape for "${baseR.method}")`,
      });
    }
    if (baseR.responseSchemaHash !== nextR.responseSchemaHash) {
      out.push({
        service: base.name,
        kind: 'response-changed',
        breaking: true,
        route: key,
        detail: `response schema changed (callers may need to update how they read the result of "${baseR.method}")`,
      });
    }
  }
  for (const [key, nextR] of nextRoutes) {
    if (baseRoutes.has(key)) continue;
    out.push({
      service: base.name,
      kind: 'route-added',
      breaking: false,
      route: key,
      detail: `new route ${key} (peer method "${nextR.method}") added`,
    });
  }

  return out;
}

/**
 * Format the change list for terminal + GitHub Actions annotations. Caller
 * picks the destination (stdout vs core::error::).
 */
export interface FormatOptions {
  /** When true, prefix breaking lines with `::error::` for GitHub Actions. */
  githubAnnotations?: boolean;
  /** When true, suppresses the trailing summary line. */
  quiet?: boolean;
}

export function formatChanges(
  changes: ContractChange[],
  opts: FormatOptions = {},
): string {
  if (changes.length === 0) {
    return opts.quiet ? '' : '✓ No contract changes.';
  }
  const lines: string[] = [];
  const breaking = changes.filter((c) => c.breaking);
  const additive = changes.filter((c) => !c.breaking);

  if (breaking.length > 0) {
    lines.push(`✗ ${breaking.length} breaking change${breaking.length === 1 ? '' : 's'}:`);
    for (const c of breaking) {
      const prefix = opts.githubAnnotations ? '::error::' : '  ';
      const where = c.route ? ` [${c.route}]` : '';
      lines.push(`${prefix}${c.service}${where} — ${c.detail}`);
    }
  }
  if (additive.length > 0) {
    if (breaking.length > 0) lines.push('');
    lines.push(`+ ${additive.length} additive change${additive.length === 1 ? '' : 's'}:`);
    for (const c of additive) {
      const where = c.route ? ` [${c.route}]` : '';
      lines.push(`  ${c.service}${where} — ${c.detail}`);
    }
  }
  return lines.join('\n');
}

/** Strip volatile metadata before serialising to disk. Keeps diffs stable. */
export function serializeSnapshot(snap: ContractSnapshot): string {
  // generatedAt is informational — keep it in the file but it doesn't
  // affect comparisons because diffSnapshots only reads `services`.
  return JSON.stringify(snap, null, 2) + '\n';
}
