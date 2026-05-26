import { buildGraph, readServiceNode } from '../graph-core';
import { discoverServices } from '../services';
import type { WorkspaceContext } from '../context';
import { jsonReply } from '../util';

export const PEER_GRAPH_TOOL = {
  name: 'get_peer_graph',
  config: {
    title: 'Get peer dependency graph',
    description:
      'Returns the full peer mesh of this Xenosis workspace plus any boundary ' +
      'violations. Use this to answer "why does service A get 403 from service B" — ' +
      'check `violations` for the caller→callee pair, then look at the callee\'s ' +
      '`allowedCallers` (in get_service_config) to see who is permitted. A common ' +
      'cause is a mismatched `peerName` (the caller identifies itself with one ' +
      'name but the callee expects another).',
    inputSchema: {},
  },
} as const;

export async function handleGetPeerGraph(ctx: WorkspaceContext) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);
  const nodes = await Promise.all(services.map((s) => readServiceNode(s.configPath)));
  const graph = buildGraph(nodes);
  return jsonReply({
    workspaceRoot: ctx.root,
    serviceCount: graph.services.length,
    ...graph,
  });
}
