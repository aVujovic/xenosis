import type { ILogger } from '@xenosisorg/xenosis-core';
import type { UsersServiceApi } from '@example/users-api';
import type ChargeRepository from '../repository/Charge.repository';

/**
 * Demonstrates the `this.api.<peer>.*` pattern. `api` is wired by core's
 * service-api loader from `config.peers` — every entry whose package
 * default-exports a service API spec becomes `api.<bindingName>`.
 *
 * Here `api.users` is the typed proxy for users-service's own exported
 * `UsersServiceApi`. Calling `this.api.users.findById({ id })` issues a
 * `GET /api/v1/users/:id` against the users-service baseUrl, with retry +
 * timeout + tracing handled by the shared peer transport.
 */
export default class ChargeService {
  private logger: ILogger;
  private chargeRepository: ChargeRepository;
  private api: { users: UsersServiceApi };

  constructor({
    logger,
    chargeRepository,
    api,
  }: {
    logger: ILogger;
    chargeRepository: ChargeRepository;
    api: { users: UsersServiceApi };
  }) {
    this.logger = logger;
    this.chargeRepository = chargeRepository;
    this.api = api;
  }

  async create(input: { userId: string; amount: number; currency: string }) {
    // Verify the user exists before persisting the charge. We hit the
    // public `list` endpoint (no auth) and look the id up locally — this
    // is just a demo of the typed `this.api.users.*` proxy talking to
    // users-service over HTTP. A real billing service would call an
    // authenticated `findById` and forward the request's bearer token.
    const users = await this.api.users.list({ limit: 200 });
    const user = users.find((u) => u.id === input.userId);
    if (!user) {
      throw new Error(`Cannot charge unknown user ${input.userId}`);
    }

    this.logger.info(
      `Creating charge for user=${user.email} amount=${input.amount} ${input.currency}`,
    );
    const record = this.chargeRepository.create(input);

    return {
      id: record.id,
      status: 'completed' as const,
      amount: record.amount,
      currency: record.currency,
    };
  }

  async refund(input: { chargeId: string; reason?: string }) {
    this.logger.info(`Refunding charge=${input.chargeId} reason=${input.reason ?? '(none)'}`);
    const updated = this.chargeRepository.markRefunded(input.chargeId, input.reason);
    if (!updated) {
      throw new Error(`Charge ${input.chargeId} not found`);
    }
  }

  async get(id: string) {
    const record = this.chargeRepository.find(id);
    if (!record) {
      throw new Error(`Charge ${id} not found`);
    }
    return {
      id: record.id,
      userId: record.userId,
      amount: record.amount,
      currency: record.currency,
      status: record.status,
    };
  }
}
