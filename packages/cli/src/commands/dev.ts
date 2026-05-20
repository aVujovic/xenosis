import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execa, type ResultPromise } from 'execa';
import pc from 'picocolors';
import { requireWorkspace } from '../lib/workspace';
import { log } from '../lib/log';

interface Opts {
  flags: Record<string, string | boolean>;
}

interface ServiceEntry {
  name: string;
  dir: string;
}

const COLORS = [
  pc.cyan,
  pc.magenta,
  pc.green,
  pc.yellow,
  pc.blue,
  pc.red,
] as const;

async function listServices(root: string, servicesDir: string): Promise<ServiceEntry[]> {
  const base = resolve(root, servicesDir);
  let entries: string[] = [];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }
  const services: ServiceEntry[] = [];
  for (const e of entries) {
    const dir = join(base, e);
    let s;
    try {
      s = await stat(dir);
    } catch { continue; }
    if (!s.isDirectory()) continue;
    let pkg;
    try {
      const raw = await readFile(join(dir, 'package.json'), 'utf-8');
      pkg = JSON.parse(raw);
    } catch { continue; }
    if (!pkg.name || !pkg.scripts?.dev) continue;
    services.push({ name: pkg.name, dir });
  }
  return services;
}

function pipeStream(
  stream: NodeJS.ReadableStream | null,
  label: string,
  colorize: (s: string) => string,
  isErr = false,
): void {
  if (!stream) return;
  let buf = '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const prefix = colorize(`[${label}]`);
      const out = isErr ? process.stderr : process.stdout;
      out.write(`${prefix} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.length > 0) {
      const prefix = colorize(`[${label}]`);
      const out = isErr ? process.stderr : process.stdout;
      out.write(`${prefix} ${buf}\n`);
    }
  });
}

export async function runDev({ flags }: Opts): Promise<void> {
  const { root, config } = await requireWorkspace();
  const services = await listServices(root, config.structure.services);

  if (services.length === 0) {
    log.warn(`No services found under ${config.structure.services}/`);
    log.hint('Run `xenosis create service <name>` to scaffold one.');
    return;
  }

  log.step(`Starting ${services.length} service${services.length === 1 ? '' : 's'}…`);
  for (const svc of services) log.hint(`• ${svc.name}`);
  log.blank();

  const procs: ResultPromise[] = [];

  for (let i = 0; i < services.length; i++) {
    const svc = services[i]!;
    const color = COLORS[i % COLORS.length]!;
    const label = svc.name;

    const child = execa('pnpm', ['--filter', svc.name, 'dev'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      reject: false,
    });

    pipeStream(child.stdout, label, color);
    pipeStream(child.stderr, label, color, true);

    procs.push(child);
  }

  const shutdown = (signal: NodeJS.Signals) => {
    log.blank();
    log.warn(`Received ${signal}, stopping services…`);
    for (const p of procs) {
      try { p.kill(signal); } catch {}
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Wait until all child processes exit.
  await Promise.allSettled(procs);
}
