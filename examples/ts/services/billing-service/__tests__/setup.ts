import {
  createTestContainer,
  type CreateTestContainerOptions,
  type TestContainer,
} from '@xenosisorg/xenosis-testing';

/** A known user the default users-peer mock returns, handy for assertions. */
export const TEST_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'buyer@example.com',
  name: 'Buyer',
  createdAt: new Date(),
};

/** Default peer mocks for billing-service. Override per test as needed. */
const defaultPeers: NonNullable<CreateTestContainerOptions['peers']> = {
  users: {
    // ChargeService.create() calls api.users.list() and looks the buyer up.
    list: async () => [TEST_USER],
  },
};

/**
 * Boot billing-service in-process for a test. Fixes serviceRoot (reads
 * xenosis.config.json + __tests__/test.config.json) and supplies default peer
 * mocks. Pass overrides to tweak peers/seed/etc. for a specific test — peer
 * mocks are merged per-peer, so you only override the methods you care about.
 *
 *   const ctx = await setupTestApp();                       // defaults
 *   const ctx = await setupTestApp({ peers: { users: { list: async () => [] } } });
 */
export function setupTestApp(
  overrides: CreateTestContainerOptions = {},
): Promise<TestContainer> {
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
}
