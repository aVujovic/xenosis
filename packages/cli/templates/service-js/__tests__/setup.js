import { createTestContainer } from '@xenosisorg/testing';

/**
 * Test fixture for {{serviceName}}. Boots the service in-process — real
 * controllers, real DI container — reading xenosis.config.json layered with
 * __tests__/test.config.json. Tests call setupTestApp() and override only what
 * they need.
 */

/**
 * Default peer mocks. When this service declares peers in xenosis.config.json,
 * add their default responses here, e.g.:
 *   const defaultPeers = {
 *     billing: { createCharge: async (i) => ({ id: 'ch_test', ...i }) },
 *   };
 * @type {Record<string, Record<string, (...args: any[]) => unknown>>}
 */
const defaultPeers = {};

/**
 * @param {import('@xenosisorg/testing').CreateTestContainerOptions} [overrides]
 * @returns {Promise<import('@xenosisorg/testing').TestContainer>}
 */
export function setupTestApp(overrides = {}) {
  const { peers: peerOverrides, ...rest } = overrides;

  const peers = { ...defaultPeers };
  for (const [name, impl] of Object.entries(peerOverrides ?? {})) {
    peers[name] = { ...(peers[name] ?? {}), ...impl };
  }

  return createTestContainer({
    serviceRoot: new URL('..', import.meta.url).pathname,
    peers,
    ...rest,
  });

  // Database-backed tests: if this service uses a schema package, pass a
  // `seed: async ({ mainDb }) => { ... }` callback — the kit boots an in-memory
  // Postgres (PGlite), replays migrations, and exposes the real client.
}
