import { describe, it, expect, afterEach } from 'vitest';
import psqlMain, { type PrismaClient } from '@example/psql-main';
import { createTestContainer, type TestContainer } from './index';

/**
 * Proof: a real Prisma schema running on an in-memory Postgres (PGlite), with
 * no Docker, no server, no migration CLI. The kit replays psql-main's migration
 * SQL onto a fresh PGlite, the package wraps it via createTestClient, and we
 * read/write through the genuine Prisma client.
 */
describe('createTestContainer + PGlite (real schema, real SQL)', () => {
  let ctx: TestContainer;

  afterEach(async () => {
    await ctx?.cleanup();
  });

  it('seeds and queries a user through the real Prisma client', async () => {
    ctx = await createTestContainer({
      config: { name: 'users-service-test' },
      schemas: [
        { cradleKey: 'mainDb', pkg: psqlMain, connector: { type: 'postgres' } },
      ],
    });

    const db = ctx.cradle.mainDb as PrismaClient;

    // Empty to start — tables exist (migrations replayed) but no rows.
    expect(await db.user.count()).toBe(0);

    // Write through the real client → real INSERT against PGlite.
    const created = await db.user.create({
      data: { email: 'test@example.com', name: 'Test User' },
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);

    // Read back → real SELECT.
    const found = await db.user.findUnique({ where: { email: 'test@example.com' } });
    expect(found?.name).toBe('Test User');
    expect(await db.user.count()).toBe(1);
  });

  it('enforces the schema — unique constraint on email is real', async () => {
    ctx = await createTestContainer({
      config: { name: 'users-service-test' },
      schemas: [{ cradleKey: 'mainDb', pkg: psqlMain, connector: { type: 'postgres' } }],
    });
    const db = ctx.cradle.mainDb as PrismaClient;

    await db.user.create({ data: { email: 'dup@example.com', name: 'A' } });
    await expect(
      db.user.create({ data: { email: 'dup@example.com', name: 'B' } }),
    ).rejects.toThrow();
  });

  it('isolates state between containers (fresh PGlite per call)', async () => {
    ctx = await createTestContainer({
      config: { name: 'x' },
      schemas: [{ cradleKey: 'mainDb', pkg: psqlMain, connector: { type: 'postgres' } }],
    });
    const db = ctx.cradle.mainDb as PrismaClient;
    expect(await db.user.count()).toBe(0); // not polluted by the previous test
  });
});
