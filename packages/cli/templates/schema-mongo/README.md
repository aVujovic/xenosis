# {{packageName}}

Shared MongoDB schema package. Multiple services can import this package and share the same collection types and naming.

MongoDB has no DDL migrations — collections are created lazily on first write. This package owns the **document types** and the **collection name registry**, not the schema migration history.

## Usage in a service

```jsonc
// service/xenosis.config.json
{
  "connectors": {
    "mongoMain": {
      "type": "mongo",
      "url": "mongodb://localhost:27017",
      "database": "{{schemaDbName}}"
    }
  },
  "schemas": {
    "mainDb": {
      "package": "{{packageName}}",
      "connector": "mongoMain"
    }
  }
}
```

## Edit the schema

Open `src/collections.ts` and add:
1. A document interface (e.g. `interface UserDoc`).
2. An entry in the `collections` registry (e.g. `users: 'users'`).
3. A typed accessor in `src/index.ts` (`users: () => db.collection<UserDoc>(collections.users)`).

## Usage from a service

```ts
import type { MongoConnection } from '{{packageName}}';

class UserService {
  constructor(private deps: { mainDb: MongoConnection }) {}

  async findOne(id: ObjectId) {
    return this.deps.mainDb.example().findOne({ _id: id });
  }
}
```
