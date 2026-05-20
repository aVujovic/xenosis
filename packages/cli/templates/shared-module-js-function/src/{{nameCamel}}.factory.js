/**
 * @typedef {import('@xenosisorg/xenosis-core').ILogger} ILogger
 */

/**
 * Factory style — awilix calls this with the cradle and stores the return
 * value as `cradle.{{nameCamel}}`. Good fit for opaque values (clients,
 * pre-built objects) where you don't want a class around them.
 *
 * @param {{ logger: ILogger }} deps
 */
export function {{nameCamel}}Factory({ logger }) {
  logger.info('🧩 {{NamePascal}}: factory invoked');
  return {
    // TODO: replace with your shared value. Methods can capture `logger`
    // via closure if you need it later.
    hello: 'world',
  };
}
