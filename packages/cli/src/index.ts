import pc from 'picocolors';
import { log } from './lib/log';
import { runCreateApp } from './commands/create-app';
import { runCreateSchema } from './commands/create-schema';
import { runCreateApi } from './commands/create-api';
import { runCreateSocketApi } from './commands/create-socket-api';
import { runCreateService } from './commands/create-service';
import { runCreateSharedModule } from './commands/create-shared-module';
import { runDev } from './commands/dev';
import { runGenerateManifest } from './commands/generate-manifest';
import { runSyncApi } from './commands/sync-api';
import { runGraph } from './commands/graph';
import { runGraphSnapshot } from './commands/graph-snapshot';
import { runGraphDiff } from './commands/graph-diff';
import { runCreateTest } from './commands/create-test';
import { runBuild } from './commands/build';
import { runInitMcp } from './commands/init-mcp';

interface ParsedArgs {
  command: string[];
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  // Split positionals into command tokens (first one or two) vs operands.
  const command: string[] = [];
  const operands: string[] = [];
  for (const p of positionals) {
    if (command.length < 2 && /^[a-z][a-z-]*$/.test(p) && operands.length === 0) {
      command.push(p);
    } else {
      operands.push(p);
    }
  }
  // `xenosis create schema X` → command = ['create','schema'], operands = ['X']
  // but a single-word command like `xenosis dev` shouldn't pull 'dev' twice
  return { command, positionals: operands, flags };
}

function printHelp(): void {
  console.log(`
${pc.bold('xenosis')} ${pc.dim('— Xenosis CLI')}

${pc.bold('USAGE')}
  ${pc.cyan('xenosis')} <command> [args] [--flags]

${pc.bold('COMMANDS')}
  ${pc.green('create app')} <name>        Bootstrap a new monorepo (alias: ${pc.dim('create-xenosis-app <name>')})
  ${pc.green('create schema')} <name>     Add a schema package (--orm prisma|drizzle|knex|mongo|dynamo)
  ${pc.green('create api')} <name>        Add an internal peer API package
  ${pc.green('create api')} <name> --external   Add an external API wrapper (apis/xenosis-custom/)
  ${pc.green('create socket-api')} <name>  Add a WebSocket contract package (defineSocketApi)
  ${pc.green('create service')} <name>    Add a new service with autoload + healthcheck (--lang ts|js)
  ${pc.green('create shared-module')} <name>  Add a workspace-wide cradle singleton (--lang ts|js)
  ${pc.green('create test')} <service>     Add the __tests__ scaffold (setup + supertest) to an existing service
  ${pc.green('dev')}                      Run all services in parallel + live dashboard (--ui-port, --no-ui)
  ${pc.green('generate manifest')}        Emit src/.xenosis-manifest.ts so autoload works under a production bundler
  ${pc.green('sync api')} <service>        Regenerate apis/<service>-api/src/index.ts from controllers (@peer annotations)
  ${pc.green('graph')}                    Print the peer dependency graph + lint boundaries.allowedCallers (--json)
  ${pc.green('graph snapshot')}           Freeze the peer contract (routes + schema hashes) to .xenosis/contract.json (--out)
  ${pc.green('graph diff')} [base]         Compare current source against the committed snapshot — exit 1 on breaking changes (--gha, --json, --file)
  ${pc.green('build')}                    Production build a service: generate manifest + tsup bundle → dist/ (--entry, --outDir)
  ${pc.green('init mcp')}                  Write .mcp.json so Claude / Cursor / Claude Desktop get workspace-aware tools

${pc.bold('FLAGS')}
  --scope <scope>             Override workspace scope (e.g. @myorg) for the generated package
  --port <number>             Initial port for new services (defaults to workspace defaults.port)
  --orm <name>                Schema ORM/driver: prisma | drizzle | knex | mongo | dynamo
  --db <name>                 Database engine when relevant: postgres | mysql
  --lifetime <name>           Shared module lifetime: singleton | scoped | transient (default singleton)
  --style <name>              Shared module style: class | function (default class)
  --lang <ts|js>              Template language for service, shared-module, and schema-prisma-postgres (default: ts).
                              JS variants use JSDoc; peer APIs are always TS (generics drive type-safe RPC).
  --no-install                Skip pnpm install after scaffolding
  --mcp / --no-mcp            Force enable/disable .mcp.json during \`create app\` (skips the prompt)
  --ui-port <number>          Port for the \`dev\` dashboard (default 9000)
  --no-ui                     Run \`dev\` without the dashboard (logs only)
  --help                      Show this help

${pc.bold('EXAMPLES')}
  ${pc.dim('$')} npx create-xenosis-app my-platform
  ${pc.dim('$')} cd my-platform
  ${pc.dim('$')} xenosis create schema psql-main                 # interactive ORM picker
  ${pc.dim('$')} xenosis create schema users   --orm prisma  --db postgres
  ${pc.dim('$')} xenosis create schema billing --orm prisma  --db mysql
  ${pc.dim('$')} xenosis create schema cart    --orm drizzle
  ${pc.dim('$')} xenosis create schema reports --orm knex
  ${pc.dim('$')} xenosis create schema events  --orm mongo
  ${pc.dim('$')} xenosis create schema audit   --orm dynamo
  ${pc.dim('$')} xenosis create api billing
  ${pc.dim('$')} xenosis create api stripe --external
  ${pc.dim('$')} xenosis create service users
  ${pc.dim('$')} xenosis create service users --lang js                 # JavaScript service
  ${pc.dim('$')} xenosis create test users                              # add __tests__ to an existing service
  ${pc.dim('$')} xenosis sync api users                                 # regenerate apis/users-api from /** @peer */ JSDoc
  ${pc.dim('$')} xenosis create shared-module whitelabel
  ${pc.dim('$')} xenosis create shared-module flags --lang js           # JavaScript shared module
  ${pc.dim('$')} xenosis create schema billing --orm prisma --lang js   # JavaScript Prisma wrapper
  ${pc.dim('$')} xenosis create shared-module feature-flags --lifetime singleton --style function
  ${pc.dim('$')} xenosis dev
  ${pc.dim('$')} xenosis graph                                         # who-calls-who + boundary lint
  ${pc.dim('$')} cd services/users-service && xenosis build            # manifest + tsup bundle → dist/
`);
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv);

  if (flags.help || command.length === 0) {
    printHelp();
    return;
  }

  try {
    const head = command[0];
    const sub = command[1];

    if (head === 'create' && sub === 'app') {
      await runCreateApp({ name: positionals[0], flags });
    } else if (head === 'create-app') {
      // Internal alias used by `create-xenosis-app` bin.
      await runCreateApp({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'schema') {
      await runCreateSchema({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'api') {
      await runCreateApi({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'socket-api') {
      await runCreateSocketApi({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'service') {
      await runCreateService({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'shared-module') {
      await runCreateSharedModule({ name: positionals[0], flags });
    } else if (head === 'create' && sub === 'test') {
      await runCreateTest({ name: positionals[0], flags });
    } else if (head === 'dev') {
      await runDev({ flags });
    } else if (head === 'generate' && sub === 'manifest') {
      await runGenerateManifest({ flags });
    } else if (head === 'sync' && sub === 'api') {
      await runSyncApi({ name: positionals[0], flags });
    } else if (head === 'graph' && sub === 'snapshot') {
      await runGraphSnapshot({ flags });
    } else if (head === 'graph' && sub === 'diff') {
      await runGraphDiff({ positional: positionals[0], flags });
    } else if (head === 'graph') {
      await runGraph({ flags });
    } else if (head === 'build') {
      await runBuild({ flags });
    } else if (head === 'init' && sub === 'mcp') {
      await runInitMcp({ flags });
    } else {
      log.err(`Unknown command: ${pc.bold([head, sub].filter(Boolean).join(' '))}`);
      printHelp();
      process.exitCode = 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.err(msg);
    process.exitCode = 1;
  }
}

main();
