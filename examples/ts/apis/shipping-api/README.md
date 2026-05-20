# @example/shipping-api

Shared PeerApi contract for the **shipping** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, shippingApi, handlers)`) and any consumer that wants a type-safe `PeerClient<ShippingApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { shippingApi } from '@example/shipping-api';

export default function ShippingApiController({ server, shippingService }) {
  mountPeerApi(server, shippingApi, {
    ping: (input) => shippingService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { ShippingApi } from '@example/shipping-api';

constructor(private deps: { shipping: PeerClient<ShippingApi> }) {}

const result = await this.deps.shipping.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "shipping": {
    "package": "@example/shipping-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
