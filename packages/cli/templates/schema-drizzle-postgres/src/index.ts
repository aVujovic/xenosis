import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import postgres from 'postgres';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';
import * as tables from './schema';

export type Database = NodePgDatabase<typeof tables>;
export { tables };
export * from './schema';

const pkg: SchemaPackage<Database> = {
  createClient(connector) {
    const url =
      connector.url ??
      `postgresql://${connector.username}:${connector.password}@${connector.host}:${connector.port}/${connector.database}`;

    const client = postgres(url) as any;
    return drizzle(client, { schema: tables }) as Database;
  },

  async disconnect(_client) {
    // Drizzle does not expose an underlying close hook; the postgres client
    // exits on process termination. Add explicit teardown here if you need it.
  },

  schema: {
    type: 'drizzle',
    schemaPath: new URL('./schema.ts', import.meta.url).pathname,
    migrationsPath: new URL('../drizzle', import.meta.url).pathname,
  },
};

export default pkg;
export const { createClient, schema, disconnect } = pkg;
