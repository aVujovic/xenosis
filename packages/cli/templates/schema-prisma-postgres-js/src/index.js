import { PrismaClient } from '@prisma/client';

export { PrismaClient };

/**
 * @typedef {import('@xenosisorg/xenosis-core').SchemaPackage<PrismaClient>} SchemaPackage
 */

/**
 * Schema package — consumed by services through xenosis.config.json:
 *   "schemas": {
 *     "mainDb": { "package": "{{packageName}}", "connector": "psqlMain" }
 *   }
 *
 * The connector named "psqlMain" must be declared in `connectors` of the
 * same config. @xenosisorg/xenosis-core calls `createClient(connector)` and registers
 * the returned PrismaClient on the consuming service's cradle.
 */

/** @type {SchemaPackage} */
const pkg = {
  createClient(connector) {
    const url =
      connector.url ??
      `postgresql://${connector.username}:${connector.password}@${connector.host}:${connector.port}/${connector.database}`;

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
