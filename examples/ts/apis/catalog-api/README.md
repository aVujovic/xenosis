# @example/catalog-api

Shared PeerApi contract for the **catalog** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, catalogApi, handlers)`) and any consumer that wants a type-safe `PeerClient<CatalogApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { catalogApi } from '@example/catalog-api';

export default function CatalogApiController({ server, catalogService }) {
  mountPeerApi(server, catalogApi, {
    ping: (input) => catalogService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { CatalogApi } from '@example/catalog-api';

constructor(private deps: { catalog: PeerClient<CatalogApi> }) {}

const result = await this.deps.catalog.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "catalog": {
    "package": "@example/catalog-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
