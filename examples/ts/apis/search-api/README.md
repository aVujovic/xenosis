# @example/search-api

Shared PeerApi contract for the **search** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, searchApi, handlers)`) and any consumer that wants a type-safe `PeerClient<SearchApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { searchApi } from '@example/search-api';

export default function SearchApiController({ server, searchService }) {
  mountPeerApi(server, searchApi, {
    ping: (input) => searchService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { SearchApi } from '@example/search-api';

constructor(private deps: { search: PeerClient<SearchApi> }) {}

const result = await this.deps.search.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "search": {
    "package": "@example/search-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
