# JS API examples — intentionally empty

Peer API packages (defined with `definePeerApi<TApi>`) **are always
TypeScript** in Xenosis, even when the consumer service is JavaScript.

## Why

The whole value proposition of a Xenosis peer API package is:

- A single `interface` describes the RPC contract.
- The generic on `definePeerApi<TApi>` flows that interface into the runtime
  routes table and — more importantly — into the `PeerClient<TApi>` proxy on
  the caller side, so every method call is type-checked against the real
  contract.

JSDoc `@typedef` cannot represent generics in the way TypeScript can. Replacing
the interface with JSDoc would turn the package into a stringly-typed HTTP
wrapper — which is exactly what `definePeerApi` exists to avoid.

## What this means in practice

- **JavaScript services can still consume** a peer API package: `import` it,
  read the routes table, call it through HTTP. They just don't get
  autocomplete or compile-time errors on the call sites.
- **TypeScript services** continue to get the full type-safe proxy.
- The `xenosis create api` command therefore has no `--lang js` mode — it
  always generates a TypeScript package.

See `examples/ts/apis/` for the canonical peer API templates.
