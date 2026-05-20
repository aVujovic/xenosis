import type { ILogger } from '@xenosisorg/xenosis-core';

/**
 * Whitelabel shared module — singleton instance available as
 * `cradle.whitelabel` in every service in this workspace.
 *
 * Anything you put on `this` is reachable through DI:
 *
 *   class SomeService {
 *     constructor(private deps: { whitelabel: Whitelabel }) {}
 *
 *     handler() {
 *       return this.deps.whitelabel.get();
 *     }
 *   }
 */
export class Whitelabel {
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
    this.logger.info('🧩 Whitelabel: loading…');
    // TODO: fetch from DB, remote config, file, etc.
    this.cache = { hello: 'world' };
  }

  get(): unknown {
    if (this.cache === undefined) {
      throw new Error('Whitelabel not loaded yet');
    }
    return this.cache;
  }
}
