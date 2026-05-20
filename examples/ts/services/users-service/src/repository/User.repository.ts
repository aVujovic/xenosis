import type { PrismaClient } from '@example/psql-main';
import type {
  CreateUserInput,
  ListUsersQuery,
} from '../services/User.service';

/**
 * Cradle key `mainDb` is wired in `xenosis.config.json` via the `schemas` block:
 *   schemas.mainDb.package    = "@example/psql-main"
 *   schemas.mainDb.connector  = "psqlMain"
 *
 * `@xenosisorg/xenosis-core`'s schema loader dynamically imports the package and registers
 * its createClient(connector) result under cradle.mainDb.
 */
export default class UserRepository {
  private mainDb: PrismaClient;

  constructor({ mainDb }: { mainDb: PrismaClient }) {
    this.mainDb = mainDb;
  }

  list(query: ListUsersQuery) {
    return this.mainDb.user.findMany({
      take: query.limit,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: CreateUserInput) {
    return this.mainDb.user.create({ data: input });
  }

  findById(id: string) {
    return this.mainDb.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.mainDb.user.findUnique({ where: { email } });
  }
}


