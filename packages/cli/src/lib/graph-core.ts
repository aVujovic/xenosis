import { dirname, basename } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * Pure peer-graph primitives — no CLI deps, no I/O beyond reading a config file.
 *
 * The `xenosis graph` command renders these; the MCP server exposes them; tests
 * compare both. Keep this file free of picocolors / log / process-aware imports
 * so any package can lift the logic without dragging the CLI in.
 */

/** A service's peer-relevant config, extracted from xenosis.config.json. */
export interface ServiceNode {
  /**
   * The service's peer identity — `config.peerName` (the short name other
   * services use as a peers cradle key and in allowedCallers), falling back to
   * `config.name` then the directory name. This is the value sent as
   * `x-xenosis-caller` and matched against a callee's allowedCallers.
   */
  name: string;
  /** Cradle keys under config.peers — the services this one calls. */
  calls: string[];
  /** config.boundaries.allowedCallers — who may call this service. */
  allowedCallers: string[] | undefined;
}

/** A detected boundary violation: `from` calls `to`, but `to` forbids it. */
export interface Violation {
  from: string;
  to: string;
}

export interface ServiceGraph {
  services: ServiceNode[];
  violations: Violation[];
}

/**
 * Pure graph builder: given the parsed service nodes, compute boundary
 * violations. A violation is when service A declares `peers.B` but B has an
 * `allowedCallers` list that does not include A.
 *
 * Calls to services not present in the workspace (e.g. external/3rd-party
 * peers) are skipped — we can only lint what we can see.
 */
export function buildGraph(services: ServiceNode[]): ServiceGraph {
  const byName = new Map(services.map((s) => [s.name, s]));
  const violations: Violation[] = [];

  for (const svc of services) {
    for (const target of svc.calls) {
      const callee = byName.get(target);
      if (!callee) continue; // external / unknown peer — can't lint
      if (!callee.allowedCallers || callee.allowedCallers.length === 0) continue;
      if (!callee.allowedCallers.includes(svc.name)) {
        violations.push({ from: svc.name, to: target });
      }
    }
  }

  return { services, violations };
}

/** Read + parse one xenosis.config.json into a ServiceNode. */
export async function readServiceNode(configPath: string): Promise<ServiceNode> {
  const raw = await readFile(configPath, 'utf-8');
  const cfg = JSON.parse(raw) as {
    name?: string;
    peerName?: string;
    peers?: Record<string, unknown>;
    boundaries?: { allowedCallers?: string[] };
  };
  const name = cfg.peerName ?? cfg.name ?? basename(dirname(configPath));
  const calls = cfg.peers ? Object.keys(cfg.peers) : [];
  return {
    name,
    calls,
    allowedCallers: cfg.boundaries?.allowedCallers,
  };
}
