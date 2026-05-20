# xenosis-custom

Folder za **eksterne API-je** koje user pokriva sopstvenim `definePeerApi` wrapper-om.

## Razlika između `apis/<name>/` i `apis/xenosis-custom/<name>/`

| | `apis/<name>/` | `apis/xenosis-custom/<name>/` |
|---|---|---|
| Vlasnik drugog kraja | tvoj Xenosis servis (mountPeerApi) | third-party (Stripe, Twilio, GitHub, internal-legacy-API, …) |
| `external` zastavica | `false` (default) | `true` |
| Auth | `apiKey` → `x-xenosis-peer-key` | obično custom (`Authorization: Bearer ...`) preko `headers` u config-u |
| Body encoding | `json` (default) | često `form-urlencoded` (Stripe, Twilio) |
| Error envelope | Xenosis `Exception` JSON | vendor-specifičan; obrađuje se kroz `errorMapper` |
| CLI tooling | `xenosis create api …` regeneriše | (kad CLI bude napravljen) **ne dira** ovu zonu |

## Šta ide ovde

- Wrapper-i za SaaS APIs: Stripe, Twilio, SendGrid, GitHub, Slack, …
- Wrapper-i za interne legacy servise koji ne pokreću Xenosis
- One-off integracije gde želiš tipove ali ne kontrolišeš drugi kraj

## Šablon

Svaki paket pod `xenosis-custom/` prati istu konvenciju kao i interni:
`package.json` + `src/index.ts` sa `definePeerApi(...)` koji ima `external: true`.

```ts
import { definePeerApi, Exception } from '@xenosisorg/xenosis-core';
import { z } from 'zod';

export interface MyApi {
  doThing(input: { foo: string }): Promise<{ ok: true }>;
}

export const myApi = definePeerApi<MyApi>({
  name: 'my-api',
  external: true,                              // ← obavezno za externe API-je
  bodyEncoding: 'form-urlencoded',              // ← opciono, default 'json'
  errorMapper: (status, body) => {              // ← opciono, default PeerHttpError
    if (status === 401) return Exception.Unauthorized(body);
    return Exception.InternalServerError(body);
  },
  routes: {
    doThing: { method: 'POST', path: '/v1/things' },
  },
});

export default myApi;
```

U servisu koji ga konzumira:

```jsonc
"peers": {
  "myApi": {
    "package": "@example/xenosis-custom-my-api",
    "transport": "http",
    "baseUrl": "https://api.example.com",
    "headers": {
      "Authorization": "Bearer ${MY_API_KEY}"
    }
  }
}
```

Sve ostalo (Proxy klijent, retry/timeout/CB, trace headers) radi identično.
