import { PrismaClient } from '@prisma/client';
import type { SchemaPackage } from '@xenosisorg/xenosis-core';

export { PrismaClient };

const pkg: SchemaPackage<PrismaClient> = {
  createClient(connector) {
    const url =
      connector.url ??
      `mysql://${connector.username}:${connector.password}@${connector.host}:${connector.port}/${connector.database}`;

    return new PrismaClient({
      datasources: { db: { url } },
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
