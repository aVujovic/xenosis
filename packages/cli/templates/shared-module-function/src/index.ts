import { asFunction } from 'awilix';
import type { SharedModule } from '@xenosisorg/xenosis-core';
import { {{nameCamel}}Factory } from './{{nameCamel}}.factory';

export type { {{NamePascal}} } from './{{nameCamel}}.factory';

/**
 * Default-export the module so @xenosisorg/xenosis-core can discover it from
 * `xenosis.workspace.json` → sharedModules.
 *
 * Cradle key: `{{nameCamel}}`
 * Lifetime:   {{lifetime}}
 */
const module: SharedModule = {
  name: '{{nameCamel}}',

  register(container) {
    container.register({
      {{nameCamel}}: asFunction({{nameCamel}}Factory).{{lifetime}}(),
    });
  },

  // Factory results aren't always async — drop this hook if you don't need it.
  // async init(cradle) { /* await something */ },
};

export default module;
