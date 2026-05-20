import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { requireWorkspace } from '../lib/workspace';
import { copyTemplate } from '../lib/template';
import { scopedSchemaName, schemaDir, validateName, toCamel } from '../lib/pkgname';
import { pnpmInstall } from '../lib/install';

interface Opts {
  name?: string;
  flags: Record<string, string | boolean>;
}

type Orm = 'prisma' | 'drizzle' | 'knex' | 'mongo' | 'dynamo';
type Db = 'postgres' | 'mysql';

interface ResolvedTemplate {
  orm: Orm;
  db?: Db;
  templateName: string;
  label: string;
  migrationsHint: string;
}

const ORM_CHOICES: { value: Orm; label: string; hint: string }[] = [
  { value: 'prisma',  label: 'Prisma',     hint: 'TS ORM with migrations & codegen' },
  { value: 'drizzle', label: 'Drizzle',    hint: 'TS-first ORM, table-as-code schema' },
  { value: 'knex',    label: 'Knex',       hint: 'Query builder + migration runner' },
  { value: 'mongo',   label: 'MongoDB',    hint: 'MongoClient, typed collections' },
  { value: 'dynamo',  label: 'DynamoDB',   hint: 'AWS SDK, table-name registry' },
];

const DB_CHOICES: { orm: Orm; choices: { value: Db; label: string }[] }[] = [
  { orm: 'prisma',  choices: [{ value: 'postgres', label: 'PostgreSQL' }, { value: 'mysql', label: 'MySQL' }] },
  { orm: 'drizzle', choices: [{ value: 'postgres', label: 'PostgreSQL' }] },
  { orm: 'knex',    choices: [{ value: 'postgres', label: 'PostgreSQL' }] },
];

function resolveTemplate(orm: Orm, db?: Db): ResolvedTemplate {
  if (orm === 'mongo') {
    return {
      orm,
      templateName: 'schema-mongo',
      label: 'MongoDB',
      migrationsHint: 'MongoDB has no DDL migrations; collections are created on first write.',
    };
  }
  if (orm === 'dynamo') {
    return {
      orm,
      templateName: 'schema-dynamo',
      label: 'DynamoDB',
      migrationsHint: 'DynamoDB tables are provisioned by IaC (CDK/Terraform); no migration runner.',
    };
  }
  if (orm === 'prisma') {
    const d = db ?? 'postgres';
    return {
      orm, db: d,
      templateName: d === 'mysql' ? 'schema-prisma-mysql' : 'schema-prisma-postgres',
      label: `Prisma + ${d === 'mysql' ? 'MySQL' : 'PostgreSQL'}`,
      migrationsHint: `DATABASE_URL='${d}://...' pnpm --filter <pkg> exec prisma migrate dev --name init`,
    };
  }
  if (orm === 'drizzle') {
    return {
      orm, db: 'postgres',
      templateName: 'schema-drizzle-postgres',
      label: 'Drizzle + PostgreSQL',
      migrationsHint: "DATABASE_URL='postgresql://...' pnpm --filter <pkg> generate && pnpm --filter <pkg> migrate",
    };
  }
  // knex
  return {
    orm, db: 'postgres',
    templateName: 'schema-knex-postgres',
    label: 'Knex + PostgreSQL',
    migrationsHint: "DATABASE_URL='postgresql://...' pnpm --filter <pkg> migrate:latest",
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function asOrm(v: string | boolean | undefined): Orm | undefined {
  if (typeof v !== 'string') return undefined;
  if (['prisma', 'drizzle', 'knex', 'mongo', 'dynamo'].includes(v)) return v as Orm;
  throw new Error(`Unknown --orm value "${v}". Allowed: prisma, drizzle, knex, mongo, dynamo`);
}

function asDb(v: string | boolean | undefined): Db | undefined {
  if (typeof v !== 'string') return undefined;
  if (['postgres', 'mysql'].includes(v)) return v as Db;
  if (v === 'postgresql' || v === 'pg') return 'postgres';
  throw new Error(`Unknown --db value "${v}". Allowed: postgres, mysql`);
}

export async function runCreateSchema({ name: positional, flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  clack.intro('Create a schema package');

  let name = positional;
  if (!name) {
    const ans = await clack.text({
      message: 'Schema name?',
      placeholder: 'psql-main',
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

  // ORM selection
  let orm = asOrm(flags.orm);
  if (!orm) {
    const ans = await clack.select({
      message: 'Which ORM / driver?',
      options: ORM_CHOICES.map((c) => ({ value: c.value, label: c.label, hint: c.hint })),
      initialValue: 'prisma' as Orm,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Cancelled.');
      process.exit(0);
    }
    orm = ans as Orm;
  }

  // DB selection (only for SQL ORMs)
  let db = asDb(flags.db);
  const dbChoices = DB_CHOICES.find((d) => d.orm === orm);
  if (dbChoices && !db) {
    if (dbChoices.choices.length === 1) {
      db = dbChoices.choices[0]!.value;
    } else {
      const ans = await clack.select({
        message: 'Which database engine?',
        options: dbChoices.choices.map((c) => ({ value: c.value, label: c.label })),
        initialValue: 'postgres' as Db,
      });
      if (clack.isCancel(ans)) {
        clack.cancel('Cancelled.');
        process.exit(0);
      }
      db = ans as Db;
    }
  }

  const tpl = resolveTemplate(orm, db);

  const scope = typeof flags.scope === 'string' ? flags.scope : config.scope;
  const packageName = scopedSchemaName(scope, name);
  const dirName = schemaDir(name);
  const dest = resolve(root, config.structure.schemas, dirName);

  if (await exists(dest)) {
    throw new Error(`Schema directory already exists: ${dest}`);
  }

  const tokens = {
    packageName,
    schemaName: name,
    schemaCamel: toCamel(name),
    schemaDbName: name.replace(/-/g, '_'),
  };

  const lang = typeof flags.lang === 'string' ? flags.lang.toLowerCase() : 'ts';
  if (lang !== 'ts' && lang !== 'js') {
    throw new Error(`Unknown --lang "${lang}". Use "ts" or "js".`);
  }
  // JS variants exist only for Prisma postgres so far. Any other ORM with
  // --lang js falls back to the TS template with a notice.
  let templateName = tpl.templateName;
  if (lang === 'js') {
    if (tpl.templateName === 'schema-prisma-postgres') {
      templateName = 'schema-prisma-postgres-js';
    } else {
      clack.log.info(
        `--lang js has no template for "${tpl.label}" yet — generating the TypeScript variant. ` +
          `Schema packages are mostly typed wrappers, so the cost of TS here is minimal.`,
      );
    }
  }

  const s = clack.spinner();
  s.start(`Scaffolding ${packageName} (${tpl.label}${lang === 'js' && templateName.endsWith('-js') ? ', js' : ''})`);
  const written = await copyTemplate(templateName, dest, tokens);
  s.stop(`Created ${written.length} files at ${config.structure.schemas}/${dirName}/`);

  await pnpmInstall(root, flags['no-install'] === true);

  const migrationsLine = tpl.migrationsHint.split('<pkg>').join(packageName);

  clack.outro(
    [
      `🎉 ${packageName} ready (${tpl.label}).`,
      ``,
      `Next:`,
      `  1. Edit the schema:`,
      tpl.orm === 'prisma' ? `       ${config.structure.schemas}/${dirName}/prisma/schema.prisma`
        : tpl.orm === 'drizzle' ? `       ${config.structure.schemas}/${dirName}/src/schema.ts`
        : tpl.orm === 'knex' ? `       Create migrations via \`pnpm --filter ${packageName} migrate:make <name>\``
        : tpl.orm === 'mongo' ? `       ${config.structure.schemas}/${dirName}/src/collections.ts`
        : `       ${config.structure.schemas}/${dirName}/src/tables.ts`,
      `  2. ${tpl.orm === 'mongo' || tpl.orm === 'dynamo' ? tpl.migrationsHint : 'Apply migrations:'}`,
      tpl.orm === 'mongo' || tpl.orm === 'dynamo' ? `` : `       ${migrationsLine}`,
      `  3. Bind in a service's xenosis.config.json — see the README in the new package.`,
    ].filter(Boolean).join('\n'),
  );
}
