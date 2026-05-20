# {{packageName}}

Shared PeerApi contract for the **{{nameKebab}}** Xenosis service. Imported by both the provider (the service that implements `mountPeerApi(server, {{apiCamel}}, handlers)`) and any consumer that wants a type-safe `PeerClient<{{ApiPascal}}>`.

## Provider side

```ts
import { mountPeerApi } from '@xenosisorg/xenosis-core';
import { {{apiCamel}} } from '{{packageName}}';

export default function {{ApiPascal}}Controller({ server, {{nameCamel}}Service }) {
  mountPeerApi(server, {{apiCamel}}, {
    ping: (input) => {{nameCamel}}Service.ping(input),
  });
}
```

## Consumer side

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { {{ApiPascal}} } from '{{packageName}}';

constructor(private deps: { {{nameCamel}}: PeerClient<{{ApiPascal}}> }) {}

const result = await this.deps.{{nameCamel}}.ping({ message: 'hello' });
```

```jsonc
// consumer service xenosis.config.json
"peers": {
  "{{nameCamel}}": {
    "package": "{{packageName}}",
    "transport": "http",
    "baseUrl": "http://localhost:4000"
  }
}
```
