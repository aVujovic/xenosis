import type { ILogger } from '@xenosisorg/xenosis-core';

export default class ExampleService {
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  greet(name: string): string {
    this.logger.info(`Greeting ${name}`);
    return `Hello, ${name}! — from payments-service`;
  }
}
