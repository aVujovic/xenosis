import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Apply a schema package's Prisma migrations onto a fresh in-memory engine by
 * replaying the raw `migration.sql` files in order. Prisma's migrations are
 * plain Postgres DDL, which PGlite executes natively — no Prisma CLI, no schema
 * engine, no running server.
 *
 * `migrationsPath` is the package's `schema.migrationsPath` (the `prisma/
 * migrations` dir). Each timestamped subfolder holds one `migration.sql`;
 * lexical sort on the folder name is chronological by Prisma convention.
 *
 * `exec` runs one SQL string against the engine (e.g. `pglite.exec`).
 */
export async function replayPrismaMigrations(
  migrationsPath: string,
  exec: (sql: string) => Promise<unknown>,
): Promise<number> {
  let entries: string[];
  try {
    entries = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return 0;
  }

  let applied = 0;
  for (const dir of entries) {
    const sqlPath = join(migrationsPath, dir, 'migration.sql');
    let sql: string;
    try {
      sql = await readFile(sqlPath, 'utf-8');
    } catch {
      continue; // not every dir has a migration.sql (e.g. migration_lock.toml lives at root)
    }
    if (sql.trim()) {
      await exec(sql);
      applied++;
    }
  }
  return applied;
}
