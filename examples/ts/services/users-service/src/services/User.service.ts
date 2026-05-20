import type { ILogger } from '@xenosisorg/xenosis-core';
import { getRequestContext } from '@xenosisorg/xenosis-core';
import type { BillingServiceApi } from '@example/billing-api';
import type { Whitelabel } from '@example/whitelabel';
import type UserRepository from '../repository/User.repository';
import type { CurrentUser } from '../middlewares/Auth.middleware';

export interface ListUsersQuery {
  limit: number;
  cursor?: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
}

export interface UpgradeInput {
  userId: string;
  amount: number;
  currency: string;
}

export default class UserService {
  private logger: ILogger;
  private userRepository: UserRepository;
  private api: { billing: BillingServiceApi };
  private whitelabel: Whitelabel;

  constructor({
    logger,
    userRepository,
    api,
    whitelabel,
  }: {
    logger: ILogger;
    userRepository: UserRepository;
    api: { billing: BillingServiceApi };
    whitelabel: Whitelabel;
  }) {
    this.logger = logger;
    this.userRepository = userRepository;
    this.api = api;
    this.whitelabel = whitelabel;
  }

  list(query: ListUsersQuery) {
    return this.userRepository.list(query);
  }

  async create(input: CreateUserInput) {
    // Shared module (whitelabel) is injected just like config/logger — no
    // manual register, no import in service.ts. It's listed in
    // xenosis.workspace.json → sharedModules.
    const brand = this.whitelabel.get();
    this.logger.info(`Creating user ${input.email} for brand=${JSON.stringify(brand)}`);
    return this.userRepository.create(input);
  }

  findById(id: string) {
    return this.userRepository.findById(id);
  }

  /**
   * Internal peer call to billing-service via this.api.billing.
   * The typed proxy is wired by @xenosisorg/xenosis-core's service-api loader from
   * `config.peers.billing.package = "@example/billing-api"`.
   *
   * Also demonstrates reading the authenticated user from the request scope.
   * Because UserService is a singleton, we read `currentUser` via the
   * helper rather than the constructor. For per-request DI of `currentUser`
   * use a scoped service instead.
   */
  async upgrade(input: UpgradeInput) {
    const ctx = getRequestContext();
    const currentUser = ctx?.scope.cradle.currentUser as CurrentUser | undefined;

    if (currentUser && currentUser.id !== input.userId) {
      throw new Error(
        `Caller (${currentUser.email}) cannot upgrade another user (${input.userId})`,
      );
    }

    const user = await this.userRepository.findById(input.userId);
    if (!user) throw new Error(`User ${input.userId} not found`);

    this.logger.info(
      { actorId: currentUser?.id ?? '(anonymous)', targetId: user.id },
      `Charging ${input.amount} ${input.currency} for ${user.email}`,
    );

    const charge = await this.api.billing.createCharge({
      userId: user.id,
      amount: input.amount,
      currency: input.currency,
    });

    return { user, charge };
  }

  /**
   * Cross-service smoke-test endpoint. Skips auth, picks the first real
   * user from the local DB, then hits billing-service through
   * `this.api.billing.createCharge(...)` so we can verify the
   * `defineServiceApi` proxy is wired correctly end-to-end.
   *
   * billing-service in turn verifies the user exists by calling our own
   * `api.users.list(...)` — so this round-trips users → billing → users.
   */
  async chargeDemo(): Promise<{ ok: true; userId: string; charge: unknown }> {
    this.logger.info('chargeDemo: picking a user and calling billing-service');
    const users = await this.userRepository.list({ limit: 1 });
    if (users.length === 0) {
      throw new Error('No users in DB — POST /api/v1/users first.');
    }
    const target = users[0]!;
    const charge = await this.api.billing.createCharge({
      userId: target.id,
      amount: 1234,
      currency: 'USD',
    });
    return { ok: true, userId: target.id, charge };
  }
}
