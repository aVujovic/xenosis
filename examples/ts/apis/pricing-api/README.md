# @example/pricing-api

Shared PeerApi contract for the **pricing** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, pricingApi, handlers)`) and any consumer that wants a type-safe `PeerClient<PricingApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { pricingApi } from '@example/pricing-api';

export default function PricingApiController({ server, pricingService }) {
  mountPeerApi(server, pricingApi, {
    ping: (input) => pricingService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { PricingApi } from '@example/pricing-api';

constructor(private deps: { pricing: PeerClient<PricingApi> }) {}

const result = await this.deps.pricing.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "pricing": {
    "package": "@example/pricing-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
