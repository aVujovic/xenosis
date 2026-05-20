/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 */

/**
 * {{NamePascal}} shared module — singleton instance available as
 * `cradle.{{nameCamel}}` in every service in this workspace.
 *
 * Anything you put on `this` is reachable through DI:
 *
 *   class SomeService {
 *     constructor({ {{nameCamel}} }) {
 *       this.{{nameCamel}} = {{nameCamel}};
 *     }
 *     handler() {
 *       return this.{{nameCamel}}.get();
 *     }
 *   }
 */
export class {{NamePascal}} {
  /** @param {{ logger: ILogger }} deps */
  constructor({ logger }) {
    /** @type {ILogger} */
    this.logger = logger;
    /** @type {unknown} */
    this.cache = undefined;
  }

  /**
   * Optional async setup — called once at boot via the module's `init()` hook
   * (see src/index.js). Remove if you don't need bootstrap I/O.
   */
  async load() {
    this.logger.info('🧩 {{NamePascal}}: loading…');
    // TODO: fetch from DB, remote config, file, etc.
    this.cache = { hello: 'world' };
  }

  get() {
    if (this.cache === undefined) {
      throw new Error('{{NamePascal}} not loaded yet');
    }
    return this.cache;
  }
}
