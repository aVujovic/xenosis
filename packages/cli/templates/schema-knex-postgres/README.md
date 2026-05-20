# {{packageName}}

Shared Knex schema package (Postgres). Multiple services can import this package and share the same migration history.

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
# Create a new migration file under ./migrations/
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} migrate:make create_users

# Apply pending migrations
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} migrate:latest

# Rollback the most recent batch
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} migrate:rollback
```

Knex migrations are raw TS files — write `up`/`down` exports using the Knex schema builder.

## Augment the Tables type

Edit `src/index.ts` to add interfaces for each table you create. The `declare module 'knex/types/tables.js'` block registers them with Knex's type registry so `db<TableName>('table')` is fully typed.
