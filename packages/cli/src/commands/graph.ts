import { resolve, dirname, basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { sync as globSync } from 'glob';
import pc from 'picocolors';
import { log } from '../lib/log';
import { requireWorkspace } from '../lib/workspace';

interface Opts {
  flags: Record<string, string | boolean>;
}

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
async function readServiceNode(configPath: string): Promise<ServiceNode> {
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

export async function runGraph({ flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  const configPaths = globSync(`${config.structure.services}/*/xenosis.config.json`, {
    cwd: root,
    absolute: true,
  }).sort();

  if (configPaths.length === 0) {
    log.warn(
      `No services found under ${config.structure.services}/. ` +
        `Create one with \`xenosis create service <name>\`.`,
    );
    return;
  }

  const services = await Promise.all(configPaths.map(readServiceNode));
  const graph = buildGraph(services);

  if (flags.json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  log.step('Peer dependency graph');
  log.blank();

  const byName = new Map(services.map((s) => [s.name, s]));

  for (const svc of graph.services) {
    console.log(`  ${pc.bold(svc.name)}`);
    if (svc.calls.length === 0) {
      log.hint('calls: (none)');
    } else {
      const rendered = svc.calls.map((c) => {
        const callee = byName.get(c);
        // Flag a call that violates the callee's boundary inline.
        const violates =
          callee &&
          callee.allowedCallers &&
          callee.allowedCallers.length > 0 &&
          !callee.allowedCallers.includes(svc.name);
        return violates ? pc.red(`${c} ✗`) : c;
      });
      log.hint(`calls: ${rendered.join(', ')}`);
    }
    if (svc.allowedCallers && svc.allowedCallers.length > 0) {
      log.hint(`allowedCallers: ${svc.allowedCallers.join(', ')}`);
    } else {
      log.hint('allowedCallers: (open to all)');
    }
    log.blank();
  }

  if (graph.violations.length > 0) {
    log.warn(
      `${graph.violations.length} boundary violation(s) — a service calls a peer that does not allow it:`,
    );
    for (const v of graph.violations) {
      const callee = byName.get(v.to);
      log.hint(
        pc.yellow(
          `${v.from} → ${v.to}: not in ${v.to}.boundaries.allowedCallers ` +
            `(${callee?.allowedCallers?.join(', ') ?? ''})`,
        ),
      );
    }
    log.blank();
    log.hint(
      `Add the caller to the callee's boundaries.allowedCallers to permit the call.`,
    );
  } else {
    log.ok('No boundary violations.');
  }
}
