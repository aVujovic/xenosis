import knex, { type Knex } from 'knex';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';

export type Database = Knex;

// Optional: typed table interfaces so consumers get autocomplete.
// Replace these with your own once you add migrations.
export interface ExampleRow {
  id: string;
  name: string;
  created_at: Date;
}

// Augment the Knex tables registry so query builders are typed:
//   db<ExampleRow>('example').where('id', x).first();
declare module 'knex/types/tables.js' {
  interface Tables {
    example: ExampleRow;
  }
}

const pkg: SchemaPackage<Database> = {
  createClient(connector) {
    const url =
      connector.url ??
      `postgresql://${connector.username}:${connector.password}@${connector.host}:${connector.port}/${connector.database}`;

    return knex({
      client: 'pg',
      connection: url,
    });
  },

  async disconnect(client) {
    await client.destroy();
  },

  schema: {
    type: 'knex',
    migrationsPath: new URL('../migrations', import.meta.url).pathname,
  },
};

export default pkg;
export const { createClient, createTestClient, schema, disconnect } = pkg;
