import type { ChannelSpec, MessageSchema, SocketApi } from './types';

/**
 * Declare a WebSocket API contract — counterpart to `defineServiceApi` /
 * `definePeerApi` for the REST + RPC sides. Intended to live in an API
 * package (`apis/<name>-socket-api/src/index.ts`) and to be the single
 * source of truth shared between:
 *
 *   • The service that owns the handler (`src/sockets/<name>.socket.ts`).
 *   • Other services that need to broadcast outbound messages through
 *     `socketBus` and want their payloads type-checked.
 *
 * The implementation is purely declarative — no side effects, no zod
 * runtime calls. Validation happens later in the loader, when an inbound
 * message is dispatched.
 *
 * Example:
 *
 *   import &#123; defineSocketApi, z &#125; from '@xenosisorg/xenosis-core';
 *
 *   const sendMessageSchema = z.object(&#123; roomId: z.string(), text: z.string() &#125;);
 *
 *   export default defineSocketApi(&#123;
 *     name: 'chat',
 *     path: '/ws/chat',
 *     clientMessages: &#123; sendMessage: sendMessageSchema &#125;,
 *     serverMessages: &#123;
 *       message: z.object(&#123; type: z.literal('message'), text: z.string() &#125;),
 *     &#125;,
 *     channels: &#123; room: &#123; paramSchema: z.object(&#123; roomId: z.string() &#125;) &#125; &#125;,
 *   &#125;);
 */
export function defineSocketApi<
  TClient extends Record<string, MessageSchema>,
  TServer extends Record<string, MessageSchema>,
  TChannels extends Record<string, ChannelSpec>,
>(api: SocketApi<TClient, TServer, TChannels>): SocketApi<TClient, TServer, TChannels> {
  if (!api.name) throw new Error('[xenosis/sockets] defineSocketApi: `name` is required.');
  if (!api.path || !api.path.startsWith('/')) {
    throw new Error(
      `[xenosis/sockets] defineSocketApi: \`path\` must start with "/" (got ${JSON.stringify(api.path)}).`,
    );
  }
  if (!api.clientMessages || typeof api.clientMessages !== 'object') {
    throw new Error('[xenosis/sockets] defineSocketApi: `clientMessages` is required (use an empty object {} if none).');
  }
  if (!api.serverMessages || typeof api.serverMessages !== 'object') {
    throw new Error('[xenosis/sockets] defineSocketApi: `serverMessages` is required (use an empty object {} if none).');
  }
  if (!api.channels || typeof api.channels !== 'object') {
    throw new Error('[xenosis/sockets] defineSocketApi: `channels` is required (use an empty object {} if none).');
  }
  return api;
}
