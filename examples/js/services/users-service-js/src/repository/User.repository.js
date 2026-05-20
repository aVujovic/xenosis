/**
 * @typedef {import('@example/psql-main').PrismaClient} PrismaClient
 */

/**
 * UserRepository — autoloaded as cradle.userRepository.
 *
 * cradle.mainDb is wired by @xenosisorg/xenosis-core from xenosis.config.json:
 *   schemas.mainDb.package   = "@example/psql-main"
 *   schemas.mainDb.connector = "psqlMain"
 *
 * JS doesn't have type imports at runtime, but JSDoc lets editors infer
 * the same shape so autocomplete works on `this.mainDb.user.*`.
 */
export default class UserRepository {
  /**
   * @param {{ mainDb: PrismaClient }} deps
   */
  constructor({ mainDb }) {
    /** @type {PrismaClient} */
    this.mainDb = mainDb;
  }

  /**
   * @param {{ limit: number; cursor?: string }} query
   */
  list(query) {
    return this.mainDb.user.findMany({
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * @param {{ email: string; name: string }} input
   */
  create(input) {
    return this.mainDb.user.create({ data: input });
  }

  /**
   * @param {string} id
   */
  findById(id) {
    return this.mainDb.user.findUnique({ where: { id } });
  }

  /**
   * @param {string} email
   */
  findByEmail(email) {
    return this.mainDb.user.findUnique({ where: { email } });
  }
}
