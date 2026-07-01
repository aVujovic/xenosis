import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';

await xenosisBootstrap({
  container,
  autoload: {
    controllers: { pattern: 'src/api/**/*.controller.ts', style: 'build' },
  },
});

await container.cradle.commands.start();
