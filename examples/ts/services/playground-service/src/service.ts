import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';

await xenosisBootstrap({
  container,
  autoload: {
    services: {
      pattern: 'src/services/*.service.ts',
      lifetime: 'singleton',
    },
    controllers: {
      pattern: 'src/api/**/*.controller.ts',
      style: 'build',
    },
  },
});

await container.cradle.commands.start();
