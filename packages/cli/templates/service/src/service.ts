import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';

await xenosisBootstrap({
  container,
  autoload: {
    repositories: { pattern: 'src/repository/*.repository.ts', lifetime: 'singleton' },
    services:     { pattern: 'src/services/*.service.ts',      lifetime: 'singleton' },
    controllers:  { pattern: 'src/api/**/*.controller.ts',     style: 'build' },
    sockets:      { pattern: 'src/sockets/*.socket.ts',        style: 'build' },
  },
});

await container.cradle.commands.start();
