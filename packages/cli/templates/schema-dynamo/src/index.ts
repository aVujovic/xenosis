import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';
import { tables } from './tables';

export * from './tables';

export interface DynamoConnection {
  client: DynamoDBClient;
  doc: DynamoDBDocumentClient;
  tables: typeof tables;
}

const pkg: SchemaPackage<DynamoConnection> = {
  createClient(connector) {
    if (!connector.region) {
      throw new Error('connectors.<dynamo>.region is required');
    }
    const client = new DynamoDBClient({
      region: connector.region,
      ...(connector.endpoint ? { endpoint: connector.endpoint } : {}),
      ...(connector.accessKeyId && connector.secretAccessKey
        ? {
            credentials: {
              accessKeyId: connector.accessKeyId,
              secretAccessKey: connector.secretAccessKey,
            },
          }
        : {}),
    });
    return {
      client,
      doc: DynamoDBDocumentClient.from(client),
      tables,
    };
  },

  disconnect(conn) {
    conn.client.destroy();
  },

  schema: {
    type: 'dynamo',
  },
};

export default pkg;
export const { createClient, createTestClient, schema, disconnect } = pkg;
