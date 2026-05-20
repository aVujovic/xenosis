# {{packageName}}

Shared Drizzle ORM schema package (Postgres). Multiple services can import this package — all of them get identical types and the same tables when bound to the same Postgres URL.

## Usage in a service

```jsonc
// service/xenosis.config.json
{
  "connectors": {
    "psqlMain": {
      "type": "postgres",
      "url": "postgresql://user:pass@localhost:5432/{{schemaDbName}}"
    }
  },
  "schemas": {
    "mainDb": {
      "package": "{{packageName}}",
      "connector": "psqlMain"
    }
  }
}
```

## Migrations

```bash
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} generate
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} migrate
```

Or with `drizzle-kit push` for rapid iteration during development:

```bash
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} push
```

## Edit the schema

Open `src/schema.ts` and define tables using Drizzle's table builders (`pgTable`, `varchar`, `uuid`, …). After every edit run `pnpm generate` to emit a new migration.
