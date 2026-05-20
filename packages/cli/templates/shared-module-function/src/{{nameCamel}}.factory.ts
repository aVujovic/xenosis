import type { ILogger } from '@xenosisorg/xenosis-core';

export interface {{NamePascal}}Deps {
  logger: ILogger;
}

/**
 * Factory style — awilix calls this with the cradle and stores the return
 * value as `cradle.{{nameCamel}}`. Good fit for opaque values (clients,
 * pre-built objects) where you don't want a class around them.
 */
export function {{nameCamel}}Factory({ logger }: {{NamePascal}}Deps) {
  logger.info('🧩 {{NamePascal}}: factory invoked');
  return {
    // TODO: replace with your shared value. Methods can capture `logger`
    // via closure if you need it later.
    hello: 'world',
  };
}

export type {{NamePascal}} = ReturnType<typeof {{nameCamel}}Factory>;
