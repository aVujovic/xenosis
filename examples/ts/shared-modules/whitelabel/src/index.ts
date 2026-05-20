import { asClass } from 'awilix';
import type { SharedModule } from '@xenosisorg/xenosis-core';
import { Whitelabel } from './Whitelabel';

export { Whitelabel };

/**
 * Default-export the module so @xenosisorg/xenosis-core can discover it from
 * `xenosis.workspace.json` → sharedModules.
 *
 * Cradle key: `whitelabel`
 * Lifetime:   singleton
 *
 * To change the lifetime later, edit the `asClass(...).<lifetime>()` call
 * below — singleton / scoped / transient are all valid.
 */
const module: SharedModule = {
  name: 'whitelabel',

  register(container) {
    container.register({
      whitelabel: asClass(Whitelabel).singleton(),
    });
  },

  // Optional: called once after every shared module is registered and BEFORE
  // commands.start(). Use for async setup; throw to abort boot.
  // Delete this hook if your module doesn't need it.
  async init(cradle) {
    await cradle.whitelabel.load();
  },
};

export default module;
