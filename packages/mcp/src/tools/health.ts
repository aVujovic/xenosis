import { z } from 'zod';
import { discoverServices, resolveService } from '../services';
import type { WorkspaceContext } from '../context';
import { errorReply, fetchWithTimeout, jsonReply } from '../util';

export const HEALTH_TOOL = {
  name: 'health_check',
  config: {
    title: 'Health-check services',
    description:
      'Hits GET /healthcheck on each service\'s local port. Returns up/down + ' +
      'response time. "down" usually means the service is not running ' +
      '(start with `xenosis dev`) or crashed at boot. Omit `service` to check all.',
    inputSchema: {
      service: z
        .string()
        .optional()
        .describe('Optional service identifier. Omit to check every service.'),
    },
  },
} as const;

export async function handleHealthCheck(
  ctx: WorkspaceContext,
  args: { service?: string },
) {
  const services = await discoverServices(ctx.root, ctx.config.structure.services);

  const targets = args.service
    ? (() => {
        const s = resolveService(services, args.service);
        return s ? [s] : [];
      })()
    : services;

  if (args.service && targets.length === 0) {
    return errorReply(`Service "${args.service}" not found.`);
  }

  const results = await Promise.all(
    targets.map(async (s) => {
      if (s.port == null) {
        return {
          name: s.peerName,
          port: null,
          status: 'unknown' as const,
          reason: 'no `port` in xenosis.config.json',
        };
      }
      const started = Date.now();
      try {
        const r = await fetchWithTimeout(`http://localhost:${s.port}/healthcheck`, 1500);
        return {
          name: s.peerName,
          port: s.port,
          status: (r.ok ? 'up' : 'down') as 'up' | 'down',
          httpStatus: r.status,
          durationMs: Date.now() - started,
        };
      } catch (err) {
        return {
          name: s.peerName,
          port: s.port,
          status: 'down' as const,
          error: (err as Error).message,
          durationMs: Date.now() - started,
        };
      }
    }),
  );

  return jsonReply({ services: results });
}
