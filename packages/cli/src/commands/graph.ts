import { sync as globSync } from 'glob';
import pc from 'picocolors';
import { log } from '../lib/log';
import { requireWorkspace } from '../lib/workspace';
import {
  buildGraph,
  readServiceNode,
  type ServiceNode,
  type ServiceGraph,
  type Violation,
} from '../lib/graph-core';

// Re-export the pure primitives so external imports of graph.ts (if any) keep
// compiling. The MCP package has its own copy of graph-core; do not depend on
// these re-exports from outside the CLI.
export { buildGraph };
export type { ServiceNode, ServiceGraph, Violation };

interface Opts {
  flags: Record<string, string | boolean>;
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
