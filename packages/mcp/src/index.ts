import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { findWorkspaceRoot, readWorkspaceConfig } from './workspace';
import { PEER_GRAPH_TOOL, handleGetPeerGraph } from './tools/peerGraph';
import { SERVICE_CONFIG_TOOL, handleGetServiceConfig } from './tools/serviceConfig';
import { HEALTH_TOOL, handleHealthCheck } from './tools/health';
import { OPENAPI_TOOL, handleGetOpenapi } from './tools/openapi';
import { EXPLAIN_TRACE_TOOL, handleExplainTrace } from './tools/explainTrace';
import { SIMULATE_CHANGE_TOOL, handleSimulateChange } from './tools/simulateChange';
import { EVENT_GRAPH_TOOL, handleGetEventGraph } from './tools/eventGraph';
import { errorReply } from './util';
import type { WorkspaceContext } from './context';

/**
 * Xenosis MCP server — read-only introspection of a Xenosis workspace for AI
 * assistants. Spoken over stdio (the transport every MCP client supports).
 *
 * IMPORTANT: stdout is reserved for the MCP protocol. Anything we want to log
 * MUST go to stderr — a stray console.log will corrupt the JSON-RPC stream and
 * the client will silently disconnect.
 */

const PKG_VERSION = '0.1.1';

function log(msg: string): void {
  process.stderr.write(`[xenosis-mcp] ${msg}\n`);
}

async function resolveContext(): Promise<WorkspaceContext | null> {
  // `XENOSIS_WORKSPACE_ROOT` lets the user pin a workspace in their MCP client
  // config — important because clients often launch the server from an
  // unpredictable cwd (e.g. the user's home directory).
  const startFrom = process.env.XENOSIS_WORKSPACE_ROOT ?? process.cwd();
  const root = await findWorkspaceRoot(startFrom);
  if (!root) return null;
  const config = await readWorkspaceConfig(root);
  return { root, config };
}

async function main(): Promise<void> {
  const ctx = await resolveContext();
  if (ctx) {
    log(`workspace: ${ctx.root}`);
  } else {
    log(
      'no xenosis.workspace.json found — tools will return an error. ' +
        'Set XENOSIS_WORKSPACE_ROOT or launch from inside a workspace.',
    );
  }

  const server = new McpServer({
    name: 'xenosis-mcp',
    version: PKG_VERSION,
  });

  /** Wrap a tool handler so an unresolved workspace becomes a clear MCP error
   *  instead of an unhandled rejection. */
  const guarded =
    <A>(handler: (ctx: WorkspaceContext, args: A) => Promise<unknown>) =>
    async (args: A) => {
      if (!ctx) {
        return errorReply(
          'Not inside a Xenosis workspace: no xenosis.workspace.json found in ' +
            'this or any parent directory. Set the XENOSIS_WORKSPACE_ROOT env var ' +
            'in your MCP client config to an absolute path of a workspace.',
        );
      }
      try {
        return (await handler(ctx, args)) as ReturnType<typeof errorReply>;
      } catch (err) {
        log(`tool error: ${(err as Error).stack ?? (err as Error).message}`);
        return errorReply(`Tool failed: ${(err as Error).message}`);
      }
    };

  server.registerTool(
    PEER_GRAPH_TOOL.name,
    PEER_GRAPH_TOOL.config,
    guarded((c) => handleGetPeerGraph(c)),
  );

  server.registerTool(
    SERVICE_CONFIG_TOOL.name,
    SERVICE_CONFIG_TOOL.config,
    guarded<{ service: string }>((c, a) => handleGetServiceConfig(c, a)),
  );

  server.registerTool(
    HEALTH_TOOL.name,
    HEALTH_TOOL.config,
    guarded<{ service?: string }>((c, a) => handleHealthCheck(c, a)),
  );

  server.registerTool(
    OPENAPI_TOOL.name,
    OPENAPI_TOOL.config,
    guarded<{ service: string; full?: boolean }>((c, a) => handleGetOpenapi(c, a)),
  );

  // ── Phase 2 tools ────────────────────────────────────────────────────────
  server.registerTool(
    EXPLAIN_TRACE_TOOL.name,
    EXPLAIN_TRACE_TOOL.config,
    guarded<{ traceId: string }>((c, a) => handleExplainTrace(c, a)),
  );

  server.registerTool(
    SIMULATE_CHANGE_TOOL.name,
    SIMULATE_CHANGE_TOOL.config,
    guarded<{ service: string; method?: string; addCaller?: string }>((c, a) =>
      handleSimulateChange(c, a),
    ),
  );

  // ── Events (async pub/sub) ────────────────────────────────────────────────
  server.registerTool(
    EVENT_GRAPH_TOOL.name,
    EVENT_GRAPH_TOOL.config,
    guarded((c) => handleGetEventGraph(c)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready (v${PKG_VERSION}, 7 tools)`);
}

main().catch((err) => {
  log(`fatal: ${(err as Error).stack ?? (err as Error).message}`);
  process.exit(1);
});
