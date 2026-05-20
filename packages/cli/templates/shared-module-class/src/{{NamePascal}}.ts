import type { ILogger } from '@xenosisorg/xenosis-core';

/**
 * {{NamePascal}} shared module — singleton instance available as
 * `cradle.{{nameCamel}}` in every service in this workspace.
 *
 * Anything you put on `this` is reachable through DI:
 *
 *   class SomeService {
 *     constructor(private deps: { {{nameCamel}}: {{NamePascal}} }) {}
 *
 *     handler() {
 *       return this.deps.{{nameCamel}}.get();
 *     }
 *   }
 */
export class {{NamePascal}} {
  private cache?: unknown;
  private logger: ILogger;

  constructor({ logger }: { logger: ILogger }) {
    this.logger = logger;
  }

  /**
   * Optional async setup — called once at boot via the module's `init()` hook
   * (see src/index.ts). Remove if you don't need bootstrap I/O.
   */
  async load(): Promise<void> {
    this.logger.info('🧩 {{NamePascal}}: loading…');
    // TODO: fetch from DB, remote config, file, etc.
    this.cache = { hello: 'world' };
  }

  get(): unknown {
    if (this.cache === undefined) {
      throw new Error('{{NamePascal}} not loaded yet');
    }
    return this.cache;
  }
}
