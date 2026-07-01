import { readFile, writeFile } from 'node:fs/promises';
import { sync as globSync } from 'glob';
import pc from 'picocolors';
import { log } from '../lib/log';
import { requireWorkspace } from '../lib/workspace';
import {
  buildEventGraph,
  readEventApiPackage,
  readEventServiceNode,
  type EventServiceNode,
  type RawEventApi,
} from '../lib/event-graph-core';

interface Opts {
  flags: Record<string, string | boolean>;
}

interface ServiceReport {
  name: string;
  configPath: string;
  issues: Array<{ kind: 'error' | 'warn'; message: string }>;
}

/**
 * `xenosis events verify` — atomic-contract checker.
 *
 * Statically confirms, WITHOUT running any service, that:
 *
 *   1. Every producer / both binding declares `publishes`.
 *   2. Every consumer / both binding declares `consumes`.
 *   3. Every topic key in either list exists in the api package.
 *   4. For each consumer binding, `consumes` equals the set of topic keys
 *      referenced by `src/events/*.event.ts` handlers.
 *   5. For each producer binding, `publishes` covers every topic key found in
 *      `.publish()` call sites under `src/`. Extra entries in `publishes` are
 *      allowed (a service may reserve capacity), missing entries are errors.
 *
 * With `--fix`, mismatches on `publishes` / `consumes` are patched in-place
 * in `xenosis.config.json` based on the scanned handler files and call sites.
 *
 * With `--workspace`, an additional pass flags:
 *   - topics declared in an api package with NO producer anywhere in the
 *     workspace (orphan producer);
 *   - topics declared with NO consumer (orphan consumer).
 *
 * Exit 0 when everything is aligned; exit 1 on any error-level issue.
 */
export async function runEventsVerify({ flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();

  const configPaths = globSync(
    `${config.structure.services}/*/xenosis.config.json`,
    { cwd: root, absolute: true },
  ).sort();

  if (configPaths.length === 0) {
    log.warn(
      `No services under ${config.structure.services}/. Nothing to verify.`,
    );
    return;
  }

  const services = await Promise.all(configPaths.map(readEventServiceNode));

  // Parse every referenced event api package once so we know its topic keys.
  const apiPackageNames = new Set<string>();
  for (const s of services) for (const b of s.bindings) apiPackageNames.add(b.package);
  const apiSpecs = new Map<string, RawEventApi>();
  for (const pkg of apiPackageNames) {
    const spec = await readEventApiPackage(root, pkg);
    if (spec) apiSpecs.set(pkg, spec);
  }

  const wantFix = flags.fix === true;
  const reports: ServiceReport[] = [];

  for (const svc of services) {
    const report: ServiceReport = {
      name: svc.name,
      configPath: svc.configPath,
      issues: [],
    };

    for (const b of svc.bindings) {
      const api = apiSpecs.get(b.package);
      if (!api) {
        report.issues.push({
          kind: 'warn',
          message: `${b.binding}: could not parse api package "${b.package}" — skipping topic checks`,
        });
        continue;
      }
      const apiTopics = new Set(Object.keys(api.topics));

      const isProducer = b.mode === 'producer' || b.mode === 'both';
      const isConsumer = b.mode === 'consumer' || b.mode === 'both';

      // ── PUBLISHES ──────────────────────────────────────────────────────
      if (isProducer) {
        const detected = new Set(svc.publishesByBinding[b.binding] ?? []);
        const declared = new Set(b.publishes);

        if (declared.size === 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: mode="${b.mode}" requires "publishes" list (found: ${
              detected.size === 0 ? 'no call sites detected' : [...detected].join(', ')
            })`,
          });
        }
        const badDeclared = [...declared].filter((t) => !apiTopics.has(t));
        if (badDeclared.length > 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: "publishes" references topic(s) not in api package: ${badDeclared.join(', ')}`,
          });
        }
        const detectedButUndeclared = [...detected].filter(
          (t) => apiTopics.has(t) && !declared.has(t),
        );
        if (detectedButUndeclared.length > 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: code calls .publish() on topic(s) missing from "publishes": ${detectedButUndeclared.join(', ')}`,
          });
        }
      } else if (b.publishes.length > 0) {
        report.issues.push({
          kind: 'error',
          message: `${b.binding}: mode="${b.mode}" cannot declare "publishes"`,
        });
      }

      // ── CONSUMES ───────────────────────────────────────────────────────
      if (isConsumer) {
        const handlers = new Set(svc.handlersByBinding[b.binding] ?? []);
        const declared = new Set(b.consumes);

        if (declared.size === 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: mode="${b.mode}" requires "consumes" list (found handlers for: ${
              handlers.size === 0 ? 'none' : [...handlers].join(', ')
            })`,
          });
        }
        const badDeclared = [...declared].filter((t) => !apiTopics.has(t));
        if (badDeclared.length > 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: "consumes" references topic(s) not in api package: ${badDeclared.join(', ')}`,
          });
        }
        const declaredButNoHandler = [...declared].filter(
          (t) => apiTopics.has(t) && !handlers.has(t),
        );
        if (declaredButNoHandler.length > 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: "consumes" declares [${declaredButNoHandler.join(', ')}] but no matching src/events/*.event.ts handler exists`,
          });
        }
        const handlerButUndeclared = [...handlers].filter(
          (t) => !declared.has(t),
        );
        if (handlerButUndeclared.length > 0) {
          report.issues.push({
            kind: 'error',
            message: `${b.binding}: src/events/ has handler(s) for [${handlerButUndeclared.join(', ')}] but "consumes" doesn't list them`,
          });
        }
      } else if (b.consumes.length > 0) {
        report.issues.push({
          kind: 'error',
          message: `${b.binding}: mode="${b.mode}" cannot declare "consumes"`,
        });
      }
    }

    reports.push(report);
  }

  // ─── --fix mode: patch xenosis.config.json in-place ──────────────────────
  if (wantFix) {
    await applyFixes(services, apiSpecs);
    log.ok(
      `Patched ${services.length} xenosis.config.json file(s). Re-run without --fix to confirm.`,
    );
    return;
  }

  // ─── Render report ───────────────────────────────────────────────────────
  let errorCount = 0;
  let warnCount = 0;
  log.step('Events atomic-contract verification');
  log.blank();
  for (const r of reports) {
    if (r.issues.length === 0) {
      console.log(`  ${pc.green('✓')} ${pc.bold(r.name)}`);
      continue;
    }
    console.log(`  ${pc.red('✗')} ${pc.bold(r.name)}  ${pc.dim(r.configPath)}`);
    for (const issue of r.issues) {
      const marker = issue.kind === 'error' ? pc.red('•') : pc.yellow('•');
      if (issue.kind === 'error') errorCount++;
      else warnCount++;
      console.log(`      ${marker} ${issue.message}`);
    }
  }
  log.blank();

  // ─── --workspace: cross-service orphan check ─────────────────────────────
  if (flags.workspace) {
    const graph = buildEventGraph(services, apiSpecs);
    if (graph.orphans.length > 0) {
      errorCount += graph.orphans.length;
      log.err(
        `${graph.orphans.length} orphan topic(s) — published but no consumer in the workspace:`,
      );
      for (const o of graph.orphans) {
        console.log(
          `      ${pc.red('•')} ${o.apiName}.${o.topicKey}  (wire: ${o.topic})`,
        );
      }
    }
    if (graph.unservedConsumers.length > 0) {
      errorCount += graph.unservedConsumers.length;
      log.err(
        `${graph.unservedConsumers.length} unserved consumer(s) — no producer in the workspace emits the topic:`,
      );
      for (const u of graph.unservedConsumers) {
        console.log(
          `      ${pc.red('•')} ${u.service} expects ${u.apiName}.${u.topicKey}  (wire: ${u.topic})`,
        );
      }
    }
    log.blank();
  }

  if (errorCount > 0) {
    log.err(
      `${errorCount} error(s), ${warnCount} warning(s) — contract drift detected.`,
    );
    log.hint(
      `Run ${pc.cyan('xenosis events verify --fix')} to autopopulate publishes/consumes from the actual code.`,
    );
    process.exit(1);
  } else if (warnCount > 0) {
    log.warn(`${warnCount} warning(s), 0 errors — passing.`);
  } else {
    log.ok(`All ${services.length} service(s) are atomic-consistent.`);
  }
}

async function applyFixes(
  services: EventServiceNode[],
  apiSpecs: Map<string, RawEventApi>,
): Promise<void> {
  for (const svc of services) {
    const raw = await readFile(svc.configPath, 'utf-8');
    const cfg = JSON.parse(raw) as {
      events?: Record<
        string,
        {
          mode?: 'producer' | 'consumer' | 'both';
          publishes?: string[];
          consumes?: string[];
          [k: string]: unknown;
        }
      >;
    };
    if (!cfg.events) continue;
    let dirty = false;

    for (const b of svc.bindings) {
      const api = apiSpecs.get(b.package);
      if (!api) continue;
      const apiTopics = new Set(Object.keys(api.topics));
      const isProducer = b.mode === 'producer' || b.mode === 'both';
      const isConsumer = b.mode === 'consumer' || b.mode === 'both';

      const bindingCfg = cfg.events[b.binding];
      if (!bindingCfg) continue;

      if (isProducer) {
        const detected = (svc.publishesByBinding[b.binding] ?? []).filter((t) =>
          apiTopics.has(t),
        );
        bindingCfg.publishes = detected.sort();
        dirty = true;
      } else {
        if (bindingCfg.publishes !== undefined) {
          delete bindingCfg.publishes;
          dirty = true;
        }
      }

      if (isConsumer) {
        const detected = (svc.handlersByBinding[b.binding] ?? []).filter((t) =>
          apiTopics.has(t),
        );
        bindingCfg.consumes = detected.sort();
        dirty = true;
      } else {
        if (bindingCfg.consumes !== undefined) {
          delete bindingCfg.consumes;
          dirty = true;
        }
      }
    }

    if (dirty) {
      const trailingNewline = raw.endsWith('\n') ? '\n' : '';
      await writeFile(
        svc.configPath,
        JSON.stringify(cfg, null, 2) + trailingNewline,
        'utf-8',
      );
    }
  }
}
