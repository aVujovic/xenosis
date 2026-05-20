# CLAUDE.md

Conventions for this Xenosis project live in **[AGENTS.md](./AGENTS.md)** — read
it first. It is the canonical, tool-agnostic guide (DI, autoload naming, REST
layer, schemas, peers, shared modules, CLI, dev workflow).

Quick reminders:

- Packages are `@xenosisorg/xenosis-core` and `@xenosisorg/xenosis-cli`.
- Don't hand-wire what autoload discovers — name the file correctly and place it
  in the right folder.
- Type-check must pass; `dev` runs through `tsc-watch` and won't restart on errors.
- Default export on every autoloaded file. Inject deps via a single destructured
  constructor object matching cradle keys.
