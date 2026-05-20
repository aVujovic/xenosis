# @example/whitelabel

Shared module — registered in the awilix cradle of every Xenosis service in
this workspace.

## How it's wired

This package is listed in `xenosis.workspace.json` under `sharedModules`. When
any service in the workspace boots, `@xenosisorg/xenosis-core` dynamically imports it,
calls `register(container)` to install the binding, and (if present) awaits
the `init(cradle)` hook before `commands.start()`.

## How to use it from a service

```ts
import type { Whitelabel } from '@example/whitelabel';

class SomeService {
  constructor(private deps: { whitelabel: Whitelabel }) {}

  handler() {
    return this.deps.whitelabel.get();
  }
}
```

No `container.register({...})` call needed in the service — `cradle.whitelabel` is already there.

## Files

- `src/Whitelabel.ts` — the class. Add your fields and methods here.
- `src/index.ts` — the `SharedModule` default-export; binds the class to the cradle.
