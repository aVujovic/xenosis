/**
 * Glob helpers shared by autoload, events handler discovery and the
 * `dynamicImport` cradle helper.
 *
 * glob accepts forward slashes ONLY in a pattern: backslash is its escape
 * character, not a separator. `path.join` on Windows emits backslashes, so a
 * joined pattern such as `C:\repo\svc\src\services\*.service.ts` does not
 * throw — it silently matches nothing. The failure then surfaces much later as
 * an `AwilixResolutionError` for a cradle key that "should" exist, which reads
 * as a bug in the consumer's service rather than in the loader.
 *
 * Two rules remove the whole class of bug instead of repairing one instance:
 *   - Relative patterns are never joined. glob takes the base directory as
 *     `cwd`, which is what that option exists for.
 *   - Absolute patterns (the testing kit builds its defaults by joining
 *     `serviceRoot`, so they arrive absolute) have their separators converted
 *     to `/` before they reach glob. Note `path.posix.join(root, pattern)` is
 *     NOT a fix: `root` itself carries backslashes on Windows.
 *
 * `pathImpl` is injectable so the win32 rules can be driven from any host —
 * nobody runs this suite on Windows, and a test that only fails there is a
 * test that never runs.
 */
import { sync as globSync } from 'glob';
import path from 'node:path';

/** The subset of `node:path` the helpers consult; `path.win32` satisfies it. */
export type GlobPathImpl = Pick<path.PlatformPath, 'sep' | 'isAbsolute'>;

/**
 * Convert a native path/pattern to the forward-slash form glob requires. A
 * no-op where the platform separator already is `/`, so POSIX escape
 * semantics are untouched there.
 */
export function toGlobPattern(pattern: string, sep: string = path.sep): string {
  return sep === '/' ? pattern : pattern.split(sep).join('/');
}

/**
 * Resolve `patterns` to absolute file paths. Relative patterns resolve against
 * `cwd`; absolute ones are normalised and used as-is. A pattern that matches
 * nothing contributes nothing — "no files" is `[]`, never an error. Results
 * are de-duplicated (overlapping patterns are common: `*.x.ts` + `**\/*.x.ts`).
 */
export function globFiles(
  patterns: readonly string[],
  cwd: string,
  pathImpl: GlobPathImpl = path,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of patterns) {
    const pattern = toGlobPattern(p, pathImpl.sep);
    for (const file of globSync(pattern, { cwd, absolute: true })) {
      if (!seen.has(file)) {
        seen.add(file);
        out.push(file);
      }
    }
  }
  return out;
}
