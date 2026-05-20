# @example/cart-api

Shared PeerApi contract for the **cart** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, cartApi, handlers)`) and any consumer that wants a type-safe `PeerClient<CartApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { cartApi } from '@example/cart-api';

export default function CartApiController({ server, cartService }) {
  mountPeerApi(server, cartApi, {
    ping: (input) => cartService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { CartApi } from '@example/cart-api';

constructor(private deps: { cart: PeerClient<CartApi> }) {}

const result = await this.deps.cart.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "cart": {
    "package": "@example/cart-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
