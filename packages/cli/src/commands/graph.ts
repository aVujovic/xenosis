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
import {
  buildEventGraph,
  readEventServiceNode,
  readEventApiPackage,
  type EventGraph,
  type RawEventApi,
} from '../lib/event-graph-core';

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

  // ─── Events graph branch ─────────────────────────────────────────────────
  if (flags.events) {
    await renderEventGraph(root, configPaths, !!flags.json, !!flags.tree);
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

/**
 * Render the async event graph — who produces what, who consumes what.
 *
 *   xenosis graph --events           # flat list per api / topic
 *   xenosis graph --events --tree    # ASCII tree, api → topic → roles
 *   xenosis graph --events --json    # machine-readable map for CI / MCP / dashboard
 */
async function renderEventGraph(
  root: string,
  configPaths: string[],
  jsonMode: boolean,
  treeMode: boolean,
): Promise<void> {
  const services = await Promise.all(configPaths.map(readEventServiceNode));

  // Collect every referenced event api package and parse it once.
  const apiPackageNames = new Set<string>();
  for (const s of services) for (const b of s.bindings) apiPackageNames.add(b.package);

  const apiSpecs = new Map<string, RawEventApi>();
  for (const pkg of apiPackageNames) {
    const spec = await readEventApiPackage(root, pkg);
    if (spec) apiSpecs.set(pkg, spec);
    else log.warn(`Could not parse event API package ${pc.bold(pkg)} — its topics won't appear in the graph.`);
  }

  const graph = buildEventGraph(services, apiSpecs);

  if (jsonMode) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  if (graph.apis.length === 0) {
    log.warn('No event APIs referenced by any service. Declare bindings under `events` in xenosis.config.json.');
    return;
  }

  if (treeMode) {
    renderTree(graph);
  } else {
    renderFlat(graph);
  }

  renderWarnings(graph);
}

function renderFlat(graph: EventGraph): void {
  log.step('Event graph');
  log.blank();
  for (const api of graph.apis) {
    console.log(
      `  ${pc.bold(api.name)}  ${pc.dim(`[package: ${api.package}${api.defaultTransport ? `, transport: ${api.defaultTransport}` : ''}]`)}`,
    );
    for (const t of api.topics) {
      const producers = api.producersByTopic[t.topicKey] ?? [];
      const consumers = api.consumersByTopic[t.topicKey] ?? [];
      console.log(`    ${pc.cyan(t.topicKey)}  ${pc.dim(`(topic: ${t.topic})`)}`);
      log.hint(
        `producers: ${producers.length > 0 ? producers.join(', ') : pc.dim('(none)')}`,
      );
      log.hint(
        `consumers: ${consumers.length > 0 ? consumers.join(', ') : pc.dim('(none)')}`,
      );
    }
    log.blank();
  }
}

function renderTree(graph: EventGraph): void {
  log.step('Event graph (tree)');
  log.blank();
  for (const api of graph.apis) {
    console.log(
      `${pc.bold(api.name)}  ${pc.dim(`[package: ${api.package}${api.defaultTransport ? `, transport: ${api.defaultTransport}` : ''}]`)}`,
    );
    const lastTopic = api.topics.length - 1;
    api.topics.forEach((t, i) => {
      const topicBranch = i === lastTopic ? '└──' : '├──';
      const topicIndent = i === lastTopic ? '    ' : '│   ';
      console.log(`${topicBranch} ${pc.cyan(t.topicKey)}  ${pc.dim(`(topic: ${t.topic})`)}`);

      const producers = api.producersByTopic[t.topicKey] ?? [];
      const consumers = api.consumersByTopic[t.topicKey] ?? [];
      const entries: Array<{ kind: 'producer' | 'consumer'; svc: string }> = [
        ...producers.map((svc) => ({ kind: 'producer' as const, svc })),
        ...consumers.map((svc) => ({ kind: 'consumer' as const, svc })),
      ];
      entries.forEach((e, j) => {
        const last = j === entries.length - 1;
        const lineBranch = last ? '└──' : '├──';
        const label = e.kind === 'producer' ? pc.green('producer') : pc.yellow('consumer');
        console.log(`${topicIndent}${lineBranch} ${label}: ${e.svc}`);
      });
    });
    log.blank();
  }
}

function renderWarnings(graph: EventGraph): void {
  if (graph.orphans.length > 0) {
    log.warn(
      `${graph.orphans.length} orphan topic(s) — published but no service in the workspace consumes them:`,
    );
    for (const o of graph.orphans) {
      log.hint(pc.yellow(`${o.apiName}.${o.topicKey}  (wire: ${o.topic})`));
    }
    log.blank();
  }
  if (graph.unservedConsumers.length > 0) {
    log.warn(
      `${graph.unservedConsumers.length} unserved consumer(s) — a service has a handler but no producer in the workspace emits the topic:`,
    );
    for (const u of graph.unservedConsumers) {
      log.hint(
        pc.yellow(
          `${u.service} expects ${u.apiName}.${u.topicKey}  (wire: ${u.topic})`,
        ),
      );
    }
  }
  if (graph.orphans.length === 0 && graph.unservedConsumers.length === 0) {
    log.ok('All topics have at least one producer and one consumer.');
  }
}
