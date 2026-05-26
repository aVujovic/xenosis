import { z } from 'zod';
import { discoverServices, resolveService } from '../services';
import type { WorkspaceContext } from '../context';
import { errorReply, fetchWithTimeout, jsonReply } from '../util';

export const OPENAPI_TOOL = {
  name: 'get_openapi_spec',
  config: {
    title: 'Get OpenAPI spec of a service',
    description:
      'Fetches the OpenAPI 3.1 spec of a running service. Returns a summary by ' +
      'default (paths + methods + operation summaries) which is enough for most ' +
      'questions; set `full: true` for the entire JSON. The service must be ' +
      'running (start with `xenosis dev`).',
    inputSchema: {
      service: z.string().describe('peerName, config.name, or directory name'),
      full: z
        .boolean()
        .optional()
        .describe('Return the full spec instead of a summary (can be large).'),
    },
  },
} as const;

interface OpenapiDoc {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, { summary?: string; operationId?: string }>>;
}

export async function handleGetOpenapi(
  ctx: WorkspaceContext,
  args: { service: string; full?: boolean },
) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);
  const svc = resolveService(services, args.service);
  if (!svc) return errorReply(`Service "${args.service}" not found.`);
  if (svc.port == null) {
    return errorReply(
      `Service "${svc.peerName}" has no \`port\` in its xenosis.config.json — cannot fetch spec.`,
    );
  }

  const openapiCfg = (svc.raw.openapi ?? {}) as { jsonPath?: string };
  const jsonPath = openapiCfg.jsonPath ?? '/openapi.json';
  const url = `http://localhost:${svc.port}${jsonPath}`;

  let doc: OpenapiDoc;
  try {
    const r = await fetchWithTimeout(url, 2000);
    if (!r.ok) {
      return errorReply(
        `Service "${svc.peerName}" returned HTTP ${r.status} at ${url}. ` +
          `Is OpenAPI enabled (config.openapi.enabled !== false)?`,
      );
    }
    doc = (await r.json()) as OpenapiDoc;
  } catch (err) {
    return errorReply(
      `Could not reach ${url}: ${(err as Error).message}. ` +
        `Start the service with \`xenosis dev\` and retry.`,
    );
  }

  if (args.full) return jsonReply(doc);

  // Summary: just the route list, the size most prompts can actually use.
  const routes: { method: string; path: string; summary?: string }[] = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      routes.push({
        method: method.toUpperCase(),
        path,
        ...(op.summary ? { summary: op.summary } : {}),
      });
    }
  }
  return jsonReply({
    service: svc.peerName,
    openapi: doc.openapi,
    info: doc.info,
    routeCount: routes.length,
    routes,
    hint: 'Pass `full: true` for the complete spec (schemas, params, etc).',
  });
}
