/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 * @typedef {import('../repository/User.repository.js').default} UserRepository
 */

export default class UserService {
  /**
   * @param {{ logger: ILogger; userRepository: UserRepository }} deps
   */
  constructor({ logger, userRepository }) {
    /** @type {ILogger} */
    this.logger = logger;
    /** @type {UserRepository} */
    this.userRepository = userRepository;
  }

  /**
   * @param {{ limit: number; cursor?: string }} query
   */
  list(query) {
    return this.userRepository.list(query);
  }

  /**
   * @param {{ email: string; name: string }} input
   */
  create(input) {
    this.logger.info(`[users-service-js] creating user ${input.email}`);
    return this.userRepository.create(input);
  }

  /**
   * @param {string} id
   */
  findById(id) {
    return this.userRepository.findById(id);
  }
}
