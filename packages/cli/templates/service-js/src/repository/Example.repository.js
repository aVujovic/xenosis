/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 * @typedef {{ id: string, name: string }} ExampleRecord
 */

/**
 * Repositories own data access. Autoload registers this file as the cradle key
 * `exampleRepository` (from the `Example.repository.js` filename).
 *
 * This stub returns a hard-coded value so the service runs with no database.
 * Wire up a real schema package when you're ready — see the commented Prisma
 * example below.
 */
export default class ExampleRepository {
  // ── With a database (Prisma) ────────────────────────────────────────────
  // 1. Scaffold a schema package:   xenosis create schema main
  // 2. Bind it in xenosis.config.json:
  //      "schemas": { "mainDb": { "package": "@scope/main", "connector": "..." } }
  // 3. Inject the cradle key and drop the hard-coded data:
  //
  // /** @param {{ logger: ILogger, mainDb: import('@scope/main').PrismaClient }} deps */
  // constructor({ logger, mainDb }) {
  //   this.logger = logger;
  //   this.mainDb = mainDb;
  // }
  //
  // /** @param {string} id */
  // findById(id) {
  //   return this.mainDb.example.findUnique({ where: { id } });
  // }

  /** @param {{ logger: ILogger }} deps */
  constructor({ logger }) {
    /** @type {ILogger} */
    this.logger = logger;
  }

  /**
   * Hard-coded stand-in until a schema package is wired up.
   * @param {string} id
   * @returns {ExampleRecord}
   */
  findById(id) {
    this.logger.info(`ExampleRepository.findById(${id})`);
    return { id, name: 'Example' };
  }
}
