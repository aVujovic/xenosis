import { MongoClient, type Db, type Collection } from 'mongodb';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';
import { collections, type ExampleDoc } from './collections';

export * from './collections';

export interface MongoConnection {
  client: MongoClient;
  db: Db;
  collections: typeof collections;
  /** Typed collection accessors — extend as you add new collections. */
  example: () => Collection<ExampleDoc>;
}

const pkg: SchemaPackage<MongoConnection> = {
  async createClient(connector) {
    if (!connector.url || !connector.database) {
      throw new Error('connectors.<mongo>.{url,database} are required');
    }
    const client = new MongoClient(connector.url, connector.options ?? {});
    await client.connect();
    const db = client.db(connector.database);
    return {
      client,
      db,
      collections,
      example: () => db.collection<ExampleDoc>(collections.example),
    };
  },

  async disconnect(conn) {
    await conn.client.close();
  },

  schema: {
    type: 'mongo',
  },
};

export default pkg;
export const { createClient, schema, disconnect } = pkg;
