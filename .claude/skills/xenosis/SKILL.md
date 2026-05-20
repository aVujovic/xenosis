---
name: xenosis
description: Conventions for building services in a Xenosis TypeScript microservice project — awilix DI without decorators, autoload naming, REST Handler/Request/Response, shared schema packages, type-safe peer RPC (this.api.<name>), shared modules, and the xenosis CLI. Use whenever working in a repo that has xenosis.workspace.json / xenosis.config.json or imports @xenosisorg/xenosis-core.
---

# Xenosis

This project uses **Xenosis** (`@xenosisorg/xenosis-core` + `@xenosisorg/xenosis-cli`).

The full, canonical conventions are in **[AGENTS.md](../../../AGENTS.md)** at the
repo root. Read it before writing or modifying code — it is the single source of
truth and is kept in sync with the toolkit.

## Load-bearing rules (don't violate)

1. **Autoload, don't hand-wire.** Repositories/services/controllers/jobs are
   discovered by filename convention (`*.repository.ts` → `userRepository`, etc.)
   and registered automatically. Never add manual `container.register(...)` for
   them — just create the correctly-named file with a **default export**.
2. **Type-check must pass.** `dev` runs through `tsc-watch`; the service only
   (re)starts when `tsc --noEmit` is clean. No implicit-`any` params.
3. **DI is a single destructured constructor object** keyed by cradle names. No
   decorators, no manual resolution.
4. **Peers come from config + cradle**, not from importing `apis/` at runtime.
   Call other services with `this.api.<name>.<method>()`; import API packages for
   types only. Keep contracts current with `xenosis sync api <service>`.
5. **REST** uses `Handler` + `Request.Body/Params/Query` + `Response.OK/Created/...`
   + `Exception.*`, all from `@xenosisorg/xenosis-core`.

When the user asks to add an endpoint, service, repository, schema, peer call, or
shared module, follow the patterns in AGENTS.md exactly rather than inventing
abstractions — convention-over-configuration is the whole design.
