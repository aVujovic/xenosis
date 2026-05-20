import { asFunction } from 'awilix';
import { {{nameCamel}}Factory } from './{{nameCamel}}.factory.js';

/**
 * @typedef {import('@xenosisorg/xenosis-core').SharedModule} SharedModule
 */

/**
 * Default-export the module so @xenosisorg/xenosis-core can discover it from
 * `xenosis.workspace.json` → sharedModules.
 *
 * Cradle key: `{{nameCamel}}`
 * Lifetime:   {{lifetime}}
 */

/** @type {SharedModule} */
const module = {
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
