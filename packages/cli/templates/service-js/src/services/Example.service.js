/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 */

export default class ExampleService {
  /** @param {{ logger: ILogger }} deps */
  constructor({ logger }) {
    /** @type {ILogger} */
    this.logger = logger;
  }

  /** @param {string} name */
  greet(name) {
    this.logger.info(`Greeting ${name}`);
    return `Hello, ${name}! — from {{serviceName}}`;
  }
}
