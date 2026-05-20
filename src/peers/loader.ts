import { asFunction, asValue, type AwilixContainer } from 'awilix';
import type { ILogger } from '../types';
import type { PeerApi, PeerBinding } from './types';
import { createPeerClient } from './createPeerClient';
import { createHttpTransport } from './httpTransport';
import { buildReliabilityPolicy } from './reliability';
import { childSpan } from './tracing';
import { getActiveTraceContext } from '../middlewares/requestContext.middleware';
import { importFromService } from '../libs/importFromService';

/**
 * Reads `config.peers.{name}` bindings, dynamically imports each shared API
 * package, and registers a type-safe RPC client in the awilix cradle under
 * the binding name.
 *
 * Each shared package must default-export a PeerApi (i.e. `export default
 * definePeerApi<TApi>({...})`). If a named export `peerApi` exists it is used
 * as a fallback.
 */
export async function loadPeers(
  container: AwilixContainer,
  config: any,
  logger: ILogger,
): Promise<void> {
  const peers: Record<string, PeerBinding> | undefined = config?.peers;

  // Per-peer teardown callbacks. The HTTP transport doesn't currently hold
  // long-lived resources, but future transports (queue subscribers, websocket
  // connections) will need to drain on shutdown. We expose the array so
  // `commands` can invoke each on SIGTERM, regardless of whether any peers
  // are configured.
  const disconnects: Array<() => Promise<void> | void> = [];
  container.register({
    peerDisconnects: asFunction(() => disconnects).singleton(),
  });

  if (!peers) return;

  for (const [cradleKey, binding] of Object.entries(peers)) {
    if (!binding?.package) {
      throw new Error(`peers.${cradleKey}: missing "package" field`);
    }
    if (binding.transport !== 'http') {
      throw new Error(
        `peers.${cradleKey}: unsupported transport "${binding.transport}" (V1 only supports "http")`,
      );
    }
    if (!binding.baseUrl) {
      throw new Error(`peers.${cradleKey}: missing "baseUrl" for http transport`);
    }

    const mod = (await importFromService(binding.package)) as {
      default?: PeerApi<any>;
      peerApi?: PeerApi<any>;
    };
    const api =
      (mod.default && typeof mod.default === 'object'
        ? mod.default
        : undefined) ?? mod.peerApi;

    if (!api || !api.routes) {
      throw new Error(
        `peers.${cradleKey}: package "${binding.package}" must default-export a PeerApi (use definePeerApi)`,
      );
    }

    const transport = createHttpTransport({
      baseUrl: binding.baseUrl,
      peerName: api.name,
    });

    const policy = buildReliabilityPolicy({
      ...(binding.timeoutMs !== undefined ? { timeoutMs: binding.timeoutMs } : {}),
      ...(binding.retry ? { retry: binding.retry } : {}),
      ...(binding.circuitBreaker ? { circuitBreaker: binding.circuitBreaker } : {}),
    });

    const client = createPeerClient({
      api,
      transport,
      policy,
      ...(binding.apiKey ? { apiKey: binding.apiKey } : {}),
      ...(binding.headers ? { customHeaders: binding.headers } : {}),
      ...(binding.bodyEncoding ? { bodyEncoding: binding.bodyEncoding } : {}),
      ...(config?.peerName || config?.name
        ? { callerName: config.peerName ?? config.name }
        : {}),
      // Pull the active request's trace context (set by the request middleware
      // via AsyncLocalStorage) and emit a child span for this outbound call.
      // Returns undefined when called outside a request (e.g. background job).
      getTraceContext: () => {
        const active = getActiveTraceContext();
        return active ? childSpan(active) : undefined;
      },
    });

    container.register({
      [cradleKey]: asValue(client),
    });

    const tag = api.external ? 'external' : 'internal';
    logger.info(
      `🤝 Peer loaded: ${cradleKey} ← ${binding.package} (${tag}, transport=${binding.transport}, baseUrl=${binding.baseUrl})`,
    );
  }
}
