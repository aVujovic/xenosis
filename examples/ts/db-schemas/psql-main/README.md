# @example/psql-main

Shared Prisma schema for the `User` and `Order` tables. Multiple services can import this package — all of them see identical types and query the same tables when they're bound to the same connector URL.

## Setup

```bash
cd examples/db-schemas/psql-main
DATABASE_URL='postgresql://xenosis:xenosis_dev@localhost:5432/xenosis_main' pnpm generate
DATABASE_URL='postgresql://xenosis:xenosis_dev@localhost:5432/xenosis_main' pnpm migrate:dev
```

## Consumers

- `examples/services/users-service` — `User` CRUD (`cradle.mainDb`)

Add another service that imports `@example/psql-main` and it will share both
the runtime client and the generated Prisma types.
