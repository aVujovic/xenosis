import {
  createTestContainer,
  type CreateTestContainerOptions,
  type TestContainer,
} from '@xenosisorg/xenosis-testing';

/**
 * Test fixture for {{serviceName}}. Boots the service in-process — real
 * controllers, real DI container — reading xenosis.config.json layered with
 * __tests__/test.config.json. Tests call setupTestApp() and override only what
 * they need.
 */

/**
 * Default peer mocks. When this service declares peers in xenosis.config.json,
 * add their default responses here so every test gets a sane baseline:
 *
 *   const defaultPeers = {
 *     billing: { createCharge: async (i) => ({ id: 'ch_test', ...i }) },
 *   };
 */
const defaultPeers: NonNullable<CreateTestContainerOptions['peers']> = {};

export function setupTestApp(
  overrides: CreateTestContainerOptions = {},
): Promise<TestContainer> {
  const { peers: peerOverrides, ...rest } = overrides;

  // Merge per-peer so a test overrides one method without dropping the rest.
  const peers = { ...defaultPeers };
  for (const [name, impl] of Object.entries(peerOverrides ?? {})) {
    peers[name] = { ...(peers[name] ?? {}), ...impl };
  }

  return createTestContainer({
    serviceRoot: new URL('..', import.meta.url).pathname,
    peers,
    ...rest,
  });

  // ── Database-backed tests ──────────────────────────────────────────────
  // If this service uses a schema package (config.schemas), the kit boots an
  // in-memory Postgres (PGlite), replays its migrations, and exposes the real
  // client on the cradle. Seed it like so:
  //
  //   return createTestContainer({
  //     serviceRoot: new URL('..', import.meta.url).pathname,
  //     peers,
  //     seed: async ({ mainDb }) => {
  //       await mainDb.user.create({ data: { email: 'a@b.com', name: 'A' } });
  //     },
  //     ...rest,
  //   });
}
