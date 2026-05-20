import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container.js';

await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.js', lifetime: 'singleton' },
    services:     { pattern: 'src/services/*.service.js',      lifetime: 'singleton' },
    controllers:  { pattern: 'src/api/**/*.controller.js',     style: 'build' },
  },
});

await container.cradle.commands.start();
