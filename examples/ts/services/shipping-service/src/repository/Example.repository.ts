import type { ILogger } from '@xenosisorg/xenosis-core';

/**
 * Repositories own data access. Autoload registers this file as the cradle key
 * `exampleRepository` (derived from the `Example.repository.ts` filename), so
 * any service can inject it by that name.
 *
 * This stub returns a hard-coded value so the service runs with no database.
 * Wire up a real schema package when you're ready — see the commented Prisma
 * example below.
 */
export interface ExampleRecord {
  id: string;
  name: string;
}

export default class ExampleRepository {
  private logger: ILogger;

  // ── With a database (Prisma) ────────────────────────────────────────────
  // 1. Scaffold a schema package:   xenosis create schema main
  // 2. Bind it in xenosis.config.json:
  //      "schemas": { "mainDb": { "package": "@scope/main", "connector": "..." } }
  // 3. Inject the cradle key and drop the hard-coded data:
  //
  // import type { PrismaClient } from '@scope/main';
  //
  // private mainDb: PrismaClient;
  // constructor({ logger, mainDb }: { logger: ILogger; mainDb: PrismaClient }) {
  //   this.logger = logger;
  //   this.mainDb = mainDb;
  // }
  //
  // findById(id: string) {
  //   return this.mainDb.example.findUnique({ where: { id } });
  // }

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  /** Hard-coded stand-in until a schema package is wired up. */
  findById(id: string): ExampleRecord {
    this.logger.info(`ExampleRepository.findById(${id})`);
    return { id, name: 'Example' };
  }
}
