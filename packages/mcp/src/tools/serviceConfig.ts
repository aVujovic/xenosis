import { z } from 'zod';
import { discoverServices, resolveService } from '../services';
import type { WorkspaceContext } from '../context';
import { errorReply, jsonReply, redact } from '../util';

export const SERVICE_CONFIG_TOOL = {
  name: 'get_service_config',
  config: {
    title: 'Get parsed service config',
    description:
      'Returns the parsed xenosis.config.json of one service with secrets ' +
      'redacted (tokens, JWT secrets, DB credentials masked). Use this to ' +
      'inspect peer identity (`peerName`), declared peers, `boundaries.allowedCallers`, ' +
      'the auth gate, and OpenAPI/connector/schema bindings. Service name ' +
      'matches `peerName`, `name`, or directory.',
    inputSchema: {
      service: z.string().describe('peerName, config.name, or directory name'),
    },
  },
} as const;

export async function handleGetServiceConfig(
  ctx: WorkspaceContext,
  args: { service: string },
) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);
  const svc = resolveService(services, args.service);
  if (!svc) {
    const known = services.map((s) => s.peerName).join(', ');
    return errorReply(
      `Service "${args.service}" not found. Known services: ${known || '(none)'}.`,
    );
  }
  return jsonReply({
    peerName: svc.peerName,
    name: svc.name,
    dir: svc.dir,
    port: svc.port,
    configPath: svc.configPath,
    config: redact(svc.raw),
  });
}
