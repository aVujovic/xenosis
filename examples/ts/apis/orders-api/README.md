# @example/orders-api

Shared PeerApi contract for the **orders** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, ordersApi, handlers)`) and any consumer that wants a type-safe `PeerClient<OrdersApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { ordersApi } from '@example/orders-api';

export default function OrdersApiController({ server, ordersService }) {
  mountPeerApi(server, ordersApi, {
    ping: (input) => ordersService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { OrdersApi } from '@example/orders-api';

constructor(private deps: { orders: PeerClient<OrdersApi> }) {}

const result = await this.deps.orders.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "orders": {
    "package": "@example/orders-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
