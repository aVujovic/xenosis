# @example/notifications-api

Shared PeerApi contract for the **notifications** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, notificationsApi, handlers)`) and any consumer that wants a type-safe `PeerClient<NotificationsApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { notificationsApi } from '@example/notifications-api';

export default function NotificationsApiController({ server, notificationsService }) {
  mountPeerApi(server, notificationsApi, {
    ping: (input) => notificationsService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { NotificationsApi } from '@example/notifications-api';

constructor(private deps: { notifications: PeerClient<NotificationsApi> }) {}

const result = await this.deps.notifications.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "notifications": {
    "package": "@example/notifications-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
