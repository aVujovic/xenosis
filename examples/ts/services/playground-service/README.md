# playground-service

Demonstration-only service that wraps the external `httpbin.org` API through
the Xenosis peer system. Exists to show **external peer integration** end-to-end
in isolation — runs on port `4010`, depends on no databases.

## What it shows

| Concern | Where to look |
|---|---|
| External PeerApi contract | [`@example/httpbin-api`](../../apis/xenosis-custom/httpbin-api/) |
| `external: true`, `bodyEncoding: 'form-urlencoded'`, `errorMapper` | `apis/xenosis-custom/httpbin-api/src/index.ts` |
| Custom headers (Bearer auth) | [`xenosis.config.json`](./xenosis.config.json) → `peers.httpbin.headers` |
| Type-safe `PeerClient<HttpBinApi>` injection | [`services/HttpBin.service.ts`](./src/services/HttpBin.service.ts) |
| Error mapping in practice | `GET /api/v1/httpbin/status/418` → `Exception.ImATeapot` |

## Try it

```bash
pnpm --filter playground-service dev

# Echo a form-encoded body — note the response.form fields + custom headers
curl -X POST http://localhost:4010/api/v1/httpbin/echo \
  -H 'content-type: application/json' \
  -d '{"amount":4200,"currency":"USD","note":"hello"}'

# Force a status code; errorMapper translates it
curl http://localhost:4010/api/v1/httpbin/status/418
curl http://localhost:4010/api/v1/httpbin/status/402
curl http://localhost:4010/api/v1/httpbin/status/200
```
