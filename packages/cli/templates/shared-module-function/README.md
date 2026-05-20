# {{packageName}}

Shared module — registered in the awilix cradle of every Xenosis service in
this workspace.

## How it's wired

This package is listed in `xenosis.workspace.json` under `sharedModules`. When
any service in the workspace boots, `@xenosisorg/xenosis-core` dynamically imports it and
calls `register(container)` to bind a factory to the cradle.

## How to use it from a service

```ts
import type { {{NamePascal}} } from '{{packageName}}';

class SomeService {
  constructor(private deps: { {{nameCamel}}: {{NamePascal}} }) {}

  handler() {
    return this.deps.{{nameCamel}}.hello;
  }
}
```

## Files

- `src/{{nameCamel}}.factory.ts` — the factory function. Returns the value that becomes `cradle.{{nameCamel}}`.
- `src/index.ts` — the `SharedModule` default-export.
