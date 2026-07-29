import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { copyTemplate } from '../lib/template';
import {
  scopedEventApiName,
  eventApiDir,
  validateName,
  toCamel,
  toPascal,
} from '../lib/pkgname';
import { pnpmInstall } from '../lib/install';

interface Opts {
  name?: string;
  flags: Record<string, string | boolean>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * `xenosis create event-api <name>` — scaffold a typed async event contract
 * package (the producer/consumer equivalent of `definePeerApi` / `defineSocketApi`).
 *
 * The package default-exports a `defineEventApi(...)` spec; producer and
 * consumer services import it to publish and react to events with full
 * type-safety and runtime zod validation.
 */
export async function runCreateEventApi({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Create an event API package');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Event API name (e.g. billing)?',
      placeholder: 'billing',
      validate: (v) => validateName(v) ?? undefined,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    name = ans as string;
  } else {
    const err = validateName(name);
    if (err) throw new Error(err);
  }

  const scope = typeof flags.scope === 'string' ? flags.scope : config.scope;
  const packageName = scopedEventApiName(scope, name);
  const dirName = eventApiDir(name);
  const dest = resolve(root, config.structure.apis, dirName);

  if (await exists(dest)) {
    throw new Error(`Event API directory already exists: ${dest}`);
  }

  const tokens = {
    packageName,
    nameKebab: name,
    nameCamel: toCamel(name),
    ApiPascal: toPascal(name) + 'Events',
  };

  const s = clack.spinner();
  s.start(`Scaffolding ${packageName}`);
  const written = await copyTemplate('event-api', dest, tokens);
  s.stop(`Created ${written.length} files at ${config.structure.apis}/${dirName}/`);

  await pnpmInstall(root, flags['no-install'] === true);

  clack.outro(
    [
      `🎉 ${packageName} ready.`,
      ``,
      `Next steps:`,
      `  1. Edit src/index.ts and replace the example "somethingHappened" topic with your real events.`,
      `  2. In the SERVICE that emits the events, declare the producer binding`,
      `     with an explicit publishes list (required since 0.2 — enforced at boot):`,
      ``,
      `       // xenosis.config.json`,
      `       "events": {`,
      `         "${toCamel(name)}": {`,
      `           "package": "${packageName}",`,
      `           "transport": "kafka",   // or redpanda | nats | redis-streams | memory`,
      `           "mode": "producer",`,
      `           "publishes": ["somethingHappened"]`,
      `         }`,
      `       }`,
      ``,
      `  3. In CONSUMER services, set "mode": "consumer" (or "both") with a`,
      `     consumes list matching your handler files exactly, then add a handler:`,
      ``,
      `       // xenosis.config.json → "consumes": ["somethingHappened"]`,
      ``,
      `       // src/events/<HandlerName>.event.ts`,
      `       import { defineEventHandler } from '@xenosisorg/xenosis-core';`,
      `       import api from '${packageName}';`,
      `       export default defineEventHandler(api.topics.somethingHappened, async (p, ctx) => {`,
      `         ctx.logger.info({ id: p.id }, 'received');`,
      `       });`,
      ``,
      `  4. Run \`xenosis events verify --workspace\` to check the contract,`,
      `     and \`xenosis graph --events --tree\` to see the producer/consumer mesh.`,
    ].join('\n'),
  );
}
