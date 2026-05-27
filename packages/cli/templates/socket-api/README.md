# {{packageName}}

Public WebSocket contract for `{{nameKebab}}-service`. Drives the shape of:

- `services/{{nameKebab}}-service/src/sockets/{{nameKebab}}.socket.ts` — the handler class (one method per `clientMessages` entry, plus optional `onConnect` / `onDisconnect` / `authenticate`).
- Any peer service that calls `socketBus.broadcastToChannel(...)` / `socketBus.sendToUser(...)` — payloads are type-checked against `serverMessages`.

## Wire it into the service

In `services/{{nameKebab}}-service/xenosis.config.json`:

```json
{
  "sockets": {
    "{{nameCamel}}": {
      "package": "{{packageName}}",
      "transport": "ws",
      "requireAuth": true
    }
  }
}
```

Then drop a handler at `src/sockets/{{nameKebab}}.socket.ts`:

```ts
import type { SocketHandler } from '@xenosisorg/xenosis-core';
import type {{ApiPascal}} from '{{packageName}}';

export default class {{ApiPascal}}Socket implements SocketHandler<typeof {{ApiPascal}}> {
  constructor(private deps: { requestLogger: any }) {}

  async onConnect(ctx) {
    this.deps.requestLogger.info({ userId: ctx.userId }, '{{nameKebab}} connected');
  }

  async sendMessage(ctx, body) {
    // body is typed from sendMessageSchema (roomId, text)
    ctx.broadcastToChannel(`room:${body.roomId}`, {
      type: 'message',
      roomId: body.roomId,
      userId: ctx.userId ?? 'anon',
      text: body.text,
      ts: Date.now(),
    });
  }
}
```
