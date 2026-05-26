import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { sync as globSync } from 'glob';

/**
 * Service discovery + raw config access used by every tool. Reads the workspace
 * once per call (workspaces are small; no caching invalidation headache).
 */

/** Everything a tool ever needs about a service. */
export interface ServiceInfo {
  /** Peer identity (peerName ?? name ?? dir) — what the graph keys on. */
  peerName: string;
  /** Package / display name from config.name (or dir). */
  name: string;
  /** Directory name on disk. */
  dir: string;
  /** Local HTTP port the service listens on (from config.port), if known. */
  port: number | undefined;
  /** Absolute path of xenosis.config.json. */
  configPath: string;
  /** Parsed config, untouched. Tools that surface it must redact secrets. */
  raw: Record<string, unknown>;
}

export async function discoverServices(
  workspaceRoot: string,
  servicesDir: string,
): Promise<ServiceInfo[]> {
  const paths = globSync(`${servicesDir}/*/xenosis.config.json`, {
    cwd: workspaceRoot,
    absolute: true,
  }).sort();

  const out: ServiceInfo[] = [];
  for (const p of paths) {
    try {
      const raw = JSON.parse(await readFile(p, 'utf-8')) as Record<string, unknown>;
      const dir = basename(dirname(p));
      const name = (raw.name as string | undefined) ?? dir;
      const peerName = (raw.peerName as string | undefined) ?? name;
      const port = typeof raw.port === 'number' ? (raw.port as number) : undefined;
      out.push({ peerName, name, dir, port, configPath: p, raw });
    } catch (err) {
      // Skip unparseable configs; tools log this to stderr.
      // eslint-disable-next-line no-console
      console.error(`[xenosis-mcp] failed to parse ${p}: ${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * Resolve `query` (the user/AI-provided service name) to a single ServiceInfo.
 * Accepts: peerName, config.name, or directory name — whichever the caller
 * happens to know. Returns null if ambiguous or missing.
 */
export function resolveService(
  services: ServiceInfo[],
  query: string,
): ServiceInfo | null {
  const q = query.toLowerCase();
  const matches = services.filter(
    (s) =>
      s.peerName.toLowerCase() === q ||
      s.name.toLowerCase() === q ||
      s.dir.toLowerCase() === q,
  );
  return matches.length === 1 ? matches[0]! : null;
}
