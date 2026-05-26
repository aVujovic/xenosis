import { dirname, basename } from 'node:path';
import { readFile } from 'node:fs/promises';

/**
 * Local copy of packages/cli/src/lib/graph-core.ts. Kept verbatim; a parity test
 * compares MCP output to the CLI's `xenosis graph --json` against the same
 * fixture so drift surfaces immediately. ~60 lines is light enough to dupe
 * rather than introduce a cross-package runtime dep on the CLI.
 */

export interface ServiceNode {
  name: string;
  calls: string[];
  allowedCallers: string[] | undefined;
}

export interface Violation {
  from: string;
  to: string;
}

export interface ServiceGraph {
  services: ServiceNode[];
  violations: Violation[];
}

export function buildGraph(services: ServiceNode[]): ServiceGraph {
  const byName = new Map(services.map((s) => [s.name, s]));
  const violations: Violation[] = [];

  for (const svc of services) {
    for (const target of svc.calls) {
      const callee = byName.get(target);
      if (!callee) continue;
      if (!callee.allowedCallers || callee.allowedCallers.length === 0) continue;
      if (!callee.allowedCallers.includes(svc.name)) {
        violations.push({ from: svc.name, to: target });
      }
    }
  }

  return { services, violations };
}

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
