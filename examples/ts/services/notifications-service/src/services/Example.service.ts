import type { ILogger } from '@xenosisorg/xenosis-core';
import type ExampleRepository from '../repository/Example.repository';

export default class ExampleService {
  private logger: ILogger;
  private exampleRepository: ExampleRepository;

  // Cradle keys are matched by name: `exampleRepository` is the autoloaded
  // Example.repository.ts. Add more deps (other repos, peers, shared modules)
  // the same way — destructured, no decorators.
  constructor({
    logger,
    exampleRepository,
  }: {
    logger: ILogger;
    exampleRepository: ExampleRepository;
  }) {
    this.logger = logger;
    this.exampleRepository = exampleRepository;
  }

  greet(name: string): string {
    this.logger.info(`Greeting ${name}`);
    return `Hello, ${name}! — from notifications-service`;
  }

  /** Demonstrates the repository layer (returns the stub record). */
  find(id: string) {
    return this.exampleRepository.findById(id);
  }
}
