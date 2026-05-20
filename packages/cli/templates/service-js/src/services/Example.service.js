/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 * @typedef {import('../repository/Example.repository').default} ExampleRepository
 */

export default class ExampleService {
  // Cradle keys are matched by name: `exampleRepository` is the autoloaded
  // Example.repository.js. Add more deps the same way — destructured.
  /** @param {{ logger: ILogger, exampleRepository: ExampleRepository }} deps */
  constructor({ logger, exampleRepository }) {
    /** @type {ILogger} */
    this.logger = logger;
    /** @type {ExampleRepository} */
    this.exampleRepository = exampleRepository;
  }

  /** @param {string} name */
  greet(name) {
    this.logger.info(`Greeting ${name}`);
    return `Hello, ${name}! — from {{serviceName}}`;
  }

  /**
   * Demonstrates the repository layer (returns the stub record).
   * @param {string} id
   */
  find(id) {
    return this.exampleRepository.findById(id);
  }
}
