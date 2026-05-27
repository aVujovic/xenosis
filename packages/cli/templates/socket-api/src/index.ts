import { defineSocketApi } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

/**
 * {{nameKebab}} socket API — public contract for the WebSocket surface of
 * `{{nameKebab}}-service`. Both the handler (in
 * `services/{{nameKebab}}-service/src/sockets/{{nameKebab}}.socket.ts`)
 * and any peer service that broadcasts outbound messages through
 * `socketBus` import from this package, so the shapes stay in sync.
 *
 * Three blocks make up the contract:
 *   • `clientMessages`  — what a connected client can send. The loader
 *      validates each frame's payload against the matching zod schema
 *      before invoking the handler method of the same name.
 *   • `serverMessages`  — what the server emits. Used to type the
 *      `socketBus` broadcast helpers and to keep outbound payloads stable.
 *   • `channels`        — the named channels a client can subscribe to.
 *      Static (no params) or dynamic (`<key>:<value>` — provide a
 *      `paramSchema` to type the value).
 */

const sendMessageSchema = z.object({
  roomId: z.string().min(1),
  text: z.string().min(1).max(2000),
});

const messageBroadcastSchema = z.object({
  type: z.literal('message'),
  roomId: z.string(),
  userId: z.string(),
  text: z.string(),
  ts: z.number(),
});

export default defineSocketApi({
  name: '{{nameCamel}}',
  path: '/ws/{{nameKebab}}',
  clientMessages: {
    sendMessage: sendMessageSchema,
  },
  serverMessages: {
    message: messageBroadcastSchema,
  },
  channels: {
    /** Per-room channel. Clients subscribe to e.g. `room:abc-123`. */
    room: { paramSchema: z.object({ roomId: z.string() }) },
  },
});
