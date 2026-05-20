# {{packageName}}

Shared DynamoDB schema package. Owns item-shape interfaces and the table-name registry.

DynamoDB tables are usually provisioned by IaC (CDK, Terraform, Pulumi), so this package only carries **types** and **table names** — no migration runner.

## Usage in a service

```jsonc
// service/xenosis.config.json
{
  "connectors": {
    "dynamoMain": {
      "type": "dynamo",
      "region": "eu-central-1",
      "endpoint": "http://localhost:8000",
      "accessKeyId": "local",
      "secretAccessKey": "local"
    }
  },
  "schemas": {
    "events": {
      "package": "{{packageName}}",
      "connector": "dynamoMain"
    }
  }
}
```

## Edit the schema

Open `src/tables.ts` and add:
1. An item interface (e.g. `interface EventItem`).
2. An entry in the `tables` registry (e.g. `events: 'events'`).

## Usage from a service

```ts
import type { DynamoConnection, ExampleItem } from '{{packageName}}';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

class MyService {
  constructor(private deps: { events: DynamoConnection }) {}

  async getOne(pk: string, sk: string) {
    const res = await this.deps.events.doc.send(
      new GetCommand({
        TableName: this.deps.events.tables.example,
        Key: { pk, sk },
      }),
    );
    return res.Item as ExampleItem | undefined;
  }
}
```
