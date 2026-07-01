import {
  buildEventGraph,
  readEventApiPackage,
  readEventServiceNode,
  type RawEventApi,
} from '../event-graph-core';
import { discoverServices } from '../services';
import type { WorkspaceContext } from '../context';
import { jsonReply } from '../util';

export const EVENT_GRAPH_TOOL = {
  name: 'get_event_graph',
  config: {
    title: 'Get async event dependency graph',
    description:
      'Returns the async event mesh of this Xenosis workspace: which services ' +
      'publish to which topics, which services consume them, and which topics ' +
      'have no producer / no consumer. Mirrors `xenosis graph --events --json`. ' +
      'Use this to answer "who emits charge.succeeded?" or "what reacts when ' +
      'order.created fires?" — check `apis[<n>].producersByTopic[<topicKey>]` ' +
      'and `consumersByTopic[<topicKey>]`. Orphan topics (in `orphans`) signal ' +
      'a producer with no consumer; unserved consumers (in `unservedConsumers`) ' +
      'signal a handler that depends on a topic nobody emits in this workspace. ' +
      'Source data: each service\'s xenosis.config.json `events` block + the ' +
      '`defineEventApi(...)` packages they reference + a static scan of ' +
      '`src/events/*.event.ts` for handler registrations.',
    inputSchema: {},
  },
} as const;

export async function handleGetEventGraph(ctx: WorkspaceContext) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);
  const nodes = await Promise.all(
    services.map((s) => readEventServiceNode(s.configPath)),
  );

  // Collect every referenced event api package and parse it once.
  const apiPackageNames = new Set<string>();
  for (const s of nodes) for (const b of s.bindings) apiPackageNames.add(b.package);

  const apiSpecs = new Map<string, RawEventApi>();
  const warnings: string[] = [];
  for (const pkg of apiPackageNames) {
    const spec = await readEventApiPackage(ctx.root, pkg);
    if (spec) apiSpecs.set(pkg, spec);
    else
      warnings.push(
        `Could not parse event API package "${pkg}" — its topics won't appear.`,
      );
  }

  const graph = buildEventGraph(nodes, apiSpecs);

  return jsonReply({
    workspaceRoot: ctx.root,
    apiCount: graph.apis.length,
    serviceCount: graph.services.length,
    warnings,
    ...graph,
  });
}
