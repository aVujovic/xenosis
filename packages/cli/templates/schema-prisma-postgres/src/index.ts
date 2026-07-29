import { PrismaClient } from '@prisma/client';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';

export { PrismaClient };

const pkg: SchemaPackage<PrismaClient> = {
  createClient(connector) {
    const url =
      connector.url ??
      `postgresql://${connector.username}:${connector.password}@${connector.host}:${connector.port}/${connector.database}`;

    return new PrismaClient({
      datasources: { db: { url } },
    });
  },

  // Used by @xenosisorg/xenosis-testing. The testing kit boots a PGlite
  // instance, replays this package's migrations (from schema.migrationsPath)
  // onto it, then hands the live instance here. We wrap it in the Prisma
  // driver adapter — the package owns the client, the testing kit owns the
  // engine. Optional: only loaded when tests run.
  async createTestClient(handle) {
    const { PrismaPGlite } = await import('pglite-prisma-adapter');
    const adapter = new PrismaPGlite(handle as never) as never;
    return new PrismaClient({ adapter });
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
export const { createClient, createTestClient, schema, disconnect } = pkg;
