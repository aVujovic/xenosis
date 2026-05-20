# Schema packages

Multi-service monorepo gde više servisa deli istu bazu i iste tipove. Schema paket je share-able unit; servisi ga importuju kao npm dependency (workspace).

## Šta je schema paket

npm paket koji vlasi jedan database schema (Prisma/Drizzle/Mongo collection set/Dynamo table set) i jedini je koji ga može migrirati.

```
packages/db-schemas/psql-main/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   └── index.ts
└── package.json
```

## Konvencija

Schema paket mora da exportuje (named ili default export koji zadovoljava `SchemaPackage<TClient>` iz `@xenosisorg/xenosis-core`):

```ts
import type { SchemaPackage } from '@xenosisorg/xenosis-core';
import { PrismaClient } from '@prisma/client';

const pkg: SchemaPackage<PrismaClient> = {
  createClient(connector) {
    return new PrismaClient({
      datasources: { db: { url: connector.url } },
    });
  },
  async disconnect(client) {
    await client.$disconnect();
  },
  schema: {
    type: 'prisma',
    schemaPath: new URL('../prisma/schema.prisma', import.meta.url).pathname,
    migrationsPath: new URL('../prisma/migrations', import.meta.url).pathname,
  },
};

export default pkg;
export const { createClient, schema, disconnect } = pkg;
```

`createClient(connector)` prima connector entry iz `config.connectors.{name}` — shape je `{ type, ...whatever }`. Paket sam vrši validation polja koja mu trebaju.

## Service konfiguracija

```jsonc
{
  "connectors": {
    "psqlMain":      { "type": "postgres", "url": "postgresql://..." },
    "psqlAnalytics": { "type": "postgres", "url": "postgresql://..." }
  },
  "schemas": {
    "mainDb":      { "package": "@myorg/psql-main",      "connector": "psqlMain" },
    "analyticsDb": { "package": "@myorg/psql-analytics", "connector": "psqlAnalytics" }
  }
}
```

`@xenosisorg/xenosis-core` će za svaku `schemas` stavku:
1. Dinamički importovati paket.
2. Pozvati `pkg.createClient(connectors[binding.connector])`.
3. Registrovati rezultat u awilix cradle pod ključem stavke (`mainDb`, `analyticsDb`).

Tvoje klase ih konzumiraju kroz destructured constructor injection:

```ts
class UserService {
  constructor(
    private deps: {
      mainDb: PrismaClient;
      analyticsDb: PrismaClient;
    },
  ) {}
}
```

## Više servisa, isti schema

Servis A i Servis B oba importuju `@myorg/psql-main` i pasuju isti `connector.url`. Rezultat: oba dobijaju **identične tipove** (jer importuju isti generated client) i **iste tabele** (jer su konektovani na istu fizičku bazu). Promena u `@myorg/psql-main/prisma/schema.prisma` → jedan PR, oba servisa odmah vide novi tip.

## Migracije

Migracije **ne pokreće `@xenosisorg/xenosis-core` pri startu**. Razlog: ako pet servisa pokuša istovremeno, race conditions, partial failures, deploy fluk. Migracije idu kroz separate CI job:

```bash
# u packages/db-schemas/psql-main/
pnpm prisma migrate deploy
```

Vlasnik migracije je schema paket, ne servis. Servisi su read/write **konzumenti** schema-a, ne mogu da je menjaju (na nivou code review-a, ne enforcement-a).

## Multi-database po servisu

Servis može da koristi proizvoljan broj schema-a — psql-main + mysql-billing + dynamo-events u istom servisu je validan setup. Svaki binding postaje zaseban cradle ključ:

```jsonc
"schemas": {
  "mainDb":    { "package": "@myorg/psql-main",     "connector": "psqlMain" },
  "billingDb": { "package": "@myorg/mysql-billing", "connector": "mysqlBilling" },
  "events":    { "package": "@myorg/dynamo-events", "connector": "dynamoEvents" }
}
```

## Non-Prisma šabloni

### Drizzle

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schemaTables from './schema';

const pkg: SchemaPackage = {
  createClient(connector) {
    const sql = postgres(connector.url);
    return drizzle(sql, { schema: schemaTables });
  },
  schema: { type: 'drizzle', schemaPath: './src/schema.ts' },
};
```

### Dynamo (no migrations)

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const TableName = 'events';
export interface EventRecord { pk: string; sk: string; payload: unknown }

const pkg: SchemaPackage = {
  createClient(connector) {
    const client = new DynamoDBClient({
      region: connector.region,
      endpoint: connector.endpoint,
    });
    return { doc: DynamoDBDocumentClient.from(client), raw: client, TableName };
  },
  schema: { type: 'dynamo' },
};
```

### Mongo

```ts
import { MongoClient } from 'mongodb';

const pkg: SchemaPackage = {
  async createClient(connector) {
    const client = new MongoClient(connector.url);
    await client.connect();
    return { client, db: client.db(connector.database) };
  },
  async disconnect({ client }) { await client.close(); },
  schema: { type: 'mongo' },
};
```

## Single-service fallback

Servis koji ne deli ništa može da preskoči `schemas` blok i koristi legacy provider-e direktno (`config.connectors.psql/mysql/mongo/dynamo/redis` + `cradle.prisma/mysql/...`). Single-schema fallback ostaje dostupan za simple cases.

## Versioning trade-off

Schema paket je **breaking change boundary**. Major bump → svi consumeri moraju da update-uju u istom PR-u, ili da svaki može da koristi različitu verziju (workspace + range deps). Praktično: za internal monorepo držati 1 verziju i atomic update; za multi-repo setup koristiti semver + published paket.
