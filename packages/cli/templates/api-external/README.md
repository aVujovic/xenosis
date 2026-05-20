# {{packageName}}

External API wrapper (third-party / out of our control). Lives in `apis/xenosis-custom/`. CLI tooling treats this folder as user-owned and will not regenerate it.

## Binding from a service

```jsonc
// service xenosis.config.json
"peers": {
  "{{nameCamel}}": {
    "package": "{{packageName}}",
    "transport": "http",
    "baseUrl": "https://api.example.com",
    "headers": {
      "Authorization": "Bearer ..."
    }
  }
}
```

## Usage

```ts
import type { PeerClient } from '@xenosisorg/xenosis-core';
import type { {{ApiPascal}} } from '{{packageName}}';

constructor(private deps: { {{nameCamel}}: PeerClient<{{ApiPascal}}> }) {}

await this.deps.{{nameCamel}}.ping({ message: 'hello' });
```
