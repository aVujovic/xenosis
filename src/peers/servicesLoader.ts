import { asValue, type AwilixContainer } from 'awilix';
import type { ILogger } from '../types';
import type { PeerApi, PeerBinding } from './types';
import type { XenosisConfig } from '../config.schema';
import { createPeerClient } from './createPeerClient';
import { createHttpTransport } from './httpTransport';
import { buildReliabilityPolicy } from './reliability';
import { childSpan } from './tracing';
import { getActiveTraceContext } from '../middlewares/requestContext.middleware';
import { importFromService } from '../libs/importFromService';

/**
 * Builds a single `api` aggregator in the cradle from `config.peers`. Each
 * binding whose package default-exports a `PeerApi` (typically through
 * `defineServiceApi`) becomes `api.<bindingName>`.
 *
 * This sits alongside `loadPeers` (which exposes one cradle key per binding)
 * to support the newer "every service mirrors its own controllers" pattern.
 * Both run from the same `config.peers` block, so the same binding ends up
 * in both `<name>` and `api.<name>` — callers can use whichever they prefer.
 *
 * Failures while importing a peer package are downgraded to warnings: a
 * service should still be able to boot even if a sibling service isn't yet
 * published as a package (common during incremental migration).
 */
export async function loadServiceApis(
  container: AwilixContainer,
  config: XenosisConfig,
  logger: ILogger,
): Promise<void> {
  const peers = config?.peers as Record<string, PeerBinding> | undefined;
  const callerName = config?.peerName ?? config?.name;

  const api: Record<string, unknown> = {};
  container.register({ api: asValue(api) });

  if (!peers) return;

  for (const [name, binding] of Object.entries(peers)) {
    if (!binding?.package || binding.transport !== 'http' || !binding.baseUrl) {
      // The strict version is enforced by loadPeers; here we just skip.
      continue;
    }

    let mod: any;
    try {
      mod = await importFromService(binding.package);
    } catch (err) {
      logger.warn(
        `[services] skip api.${name}: failed to import "${binding.package}" (${(err as Error).message})`,
      );
      continue;
    }

    const apiSpec: PeerApi<any> | undefined =
      (mod.default && typeof mod.default === 'object' ? mod.default : undefined) ??
      mod.peerApi ??
      mod.serviceApi;

    if (!apiSpec || !apiSpec.routes) {
      logger.warn(
        `[services] skip api.${name}: "${binding.package}" has no default-exported PeerApi/ServiceApi`,
      );
      continue;
    }

    const transport = createHttpTransport({
      baseUrl: binding.baseUrl,
      peerName: apiSpec.name,
    });

    const policy = buildReliabilityPolicy({
      ...(binding.timeoutMs !== undefined ? { timeoutMs: binding.timeoutMs } : {}),
      ...(binding.retry ? { retry: binding.retry } : {}),
      ...(binding.circuitBreaker ? { circuitBreaker: binding.circuitBreaker } : {}),
    });

    const client = createPeerClient({
      api: apiSpec,
      transport,
      policy,
      ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
      ...(binding.headers ? { customHeaders: binding.headers } : {}),
      ...(binding.bodyEncoding ? { bodyEncoding: binding.bodyEncoding } : {}),
      ...(callerName ? { callerName } : {}),
      getTraceContext: () => {
        const active = getActiveTraceContext();
        return active ? childSpan(active) : undefined;
      },
    });

    api[name] = client;

    logger.info(
      `🛰  Service API loaded: api.${name} ← ${binding.package} (baseUrl=${binding.baseUrl})`,
    );
  }
}
