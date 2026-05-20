import { asClass } from 'awilix';
import type { SharedModule } from '@xenosisorg/xenosis-core';
import { {{NamePascal}} } from './{{NamePascal}}';

export { {{NamePascal}} };

/**
 * Default-export the module so @xenosisorg/xenosis-core can discover it from
 * `xenosis.workspace.json` → sharedModules.
 *
 * Cradle key: `{{nameCamel}}`
 * Lifetime:   {{lifetime}}
 *
 * To change the lifetime later, edit the `asClass(...).<lifetime>()` call
 * below — singleton / scoped / transient are all valid.
 */
const module: SharedModule = {
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
