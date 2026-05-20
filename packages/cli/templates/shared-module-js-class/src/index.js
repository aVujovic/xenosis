import { asClass } from 'awilix';
import { {{NamePascal}} } from './{{NamePascal}}.js';

export { {{NamePascal}} };

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
      {{nameCamel}}: asClass({{NamePascal}}).{{lifetime}}(),
    });
  },

  // Optional: called once after every shared module is registered and BEFORE
  // commands.start(). Use for async setup; throw to abort boot.
  // Delete this hook if your module doesn't need it.
  async init(cradle) {
    await cradle.{{nameCamel}}.load();
  },
};

export default module;
