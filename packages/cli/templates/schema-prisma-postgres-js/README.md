# {{packageName}}

Shared Prisma schema package. Multiple services can import this package — all of them get identical types and tables when bound to the same Postgres URL.

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
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} exec prisma migrate dev --name init
DATABASE_URL='postgresql://...' pnpm --filter {{packageName}} exec prisma migrate deploy
```
