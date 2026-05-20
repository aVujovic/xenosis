# @example/inventory-api

Shared PeerApi contract for the **inventory** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, inventoryApi, handlers)`) and any consumer that wants a type-safe `PeerClient<InventoryApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { inventoryApi } from '@example/inventory-api';

export default function InventoryApiController({ server, inventoryService }) {
  mountPeerApi(server, inventoryApi, {
    ping: (input) => inventoryService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { InventoryApi } from '@example/inventory-api';

constructor(private deps: { inventory: PeerClient<InventoryApi> }) {}

const result = await this.deps.inventory.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "inventory": {
    "package": "@example/inventory-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
