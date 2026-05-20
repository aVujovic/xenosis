import { asFunction } from 'awilix';
import { xenosisBootstrap } from '@xenosisorg/xenosis-core';
import container from './container';
import { buildAuthMiddleware } from './middlewares/Auth.middleware';

// Register the auth middleware factory BEFORE xenosisBootstrap so controllers
// (mounted by autoload during xenosisBootstrap) can pull `authMiddleware` from
// the cradle. awilix resolves `asFunction` lazily — config is read on first
// access, after xenosisBootstrap has loaded it.
container.register({
  authMiddleware: asFunction(({ config }: { config: any }) =>
    buildAuthMiddleware({ jwtSecret: config.auth.jwtSecret }),
  ).singleton(),
});

await xenosisBootstrap({
  container,
  autoload: {
    repositories: {
      pattern: 'src/repository/*.repository.ts',
      lifetime: 'singleton',
    },
    services: {
      pattern: 'src/services/*.service.ts',
      lifetime: 'singleton',
    },
    controllers: {
      pattern: 'src/api/**/*.controller.ts',
      style: 'build',
    },
    jobs: {
      pattern: 'src/jobs/*.job.ts',
      lifetime: 'singleton',
    },
  },
});

// Start the HTTP server first…
await container.cradle.commands.start();

// …then kick off any background jobs. Each job decides how to run itself.
container.cradle.heartbeatJob.start();
