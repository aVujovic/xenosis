# @example/reviews-api

Shared PeerApi contract for the **reviews** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, reviewsApi, handlers)`) and any consumer that wants a type-safe `PeerClient<ReviewsApi>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { reviewsApi } from '@example/reviews-api';

export default function ReviewsApiController({ server, reviewsService }) {
  mountPeerApi(server, reviewsApi, {
    ping: (input) => reviewsService.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { ReviewsApi } from '@example/reviews-api';

constructor(private deps: { reviews: PeerClient<ReviewsApi> }) {}

const result = await this.deps.reviews.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "reviews": {
    "package": "@example/reviews-api",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
