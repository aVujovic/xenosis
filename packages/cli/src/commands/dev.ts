import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execa, type ResultPromise } from 'execa';
import pc from 'picocolors';
import { requireWorkspace } from '../lib/workspace';
import { log } from '../lib/log';
import { startDashboard, type Dashboard } from './dashboard';

/** Strip ANSI color codes — dev logs are pretty-printed; the UI wants plain text. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

const DEFAULT_UI_PORT = 9000;

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
  onLine?: (line: string) => void,
): void {
  if (!stream) return;
  let buf = '';
  stream.setEncoding('utf-8');
  const emit = (line: string) => {
    const prefix = colorize(`[${label}]`);
    const out = isErr ? process.stderr : process.stdout;
    out.write(`${prefix} ${line}\n`);
    onLine?.(line);
  };
  stream.on('data', (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      emit(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  });
  stream.on('end', () => {
    if (buf.length > 0) emit(buf);
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

  // ── Live dashboard ────────────────────────────────────────────────────────
  // Unless disabled, raise a tiny HTTP+SSE server that renders the workspace as
  // a live peer graph (nodes go green/grey by /healthcheck, click a node to read
  // its logs). It only ever reads the same data `xenosis dev` already produces.
  let dashboard: Dashboard | undefined;
  if (!flags['no-ui']) {
    const uiPort = Number(flags['ui-port']) || DEFAULT_UI_PORT;
    try {
      dashboard = await startDashboard({
        root,
        servicesDir: config.structure.services,
        port: uiPort,
      });
      log.step(`Dashboard: ${pc.cyan(dashboard.url)}`);
      log.blank();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Dashboard unavailable (port ${uiPort}): ${msg}`);
      log.hint('Logs continue below. Pass --ui-port <n> or --no-ui to silence this.');
      log.blank();
    }
  }

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

    pipeStream(child.stdout, label, color, false, (line) =>
      dashboard?.pushLog(svc.name, stripAnsi(line), 'out'),
    );
    pipeStream(child.stderr, label, color, true, (line) =>
      dashboard?.pushLog(svc.name, stripAnsi(line), 'err'),
    );

    procs.push(child);
  }

  const shutdown = (signal: NodeJS.Signals) => {
    log.blank();
    log.warn(`Received ${signal}, stopping services…`);
    void dashboard?.close();
    for (const p of procs) {
      try { p.kill(signal); } catch {}
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Wait until all child processes exit.
  await Promise.allSettled(procs);
  await dashboard?.close();
}
