# @example/payments-api

Shared PeerApi contract for the **payments** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, paymentsApi, handlers)`) and any consumer that wants a type-safe `PeerClient<PaymentsApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { paymentsApi } from '@example/payments-api';

export default function PaymentsApiController({ server, paymentsService }) {
  mountPeerApi(server, paymentsApi, {
    ping: (input) => paymentsService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { PaymentsApi } from '@example/payments-api';

constructor(private deps: { payments: PeerClient<PaymentsApi> }) {}

const result = await this.deps.payments.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "payments": {
    "package": "@example/payments-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
