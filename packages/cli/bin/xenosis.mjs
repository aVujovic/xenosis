#!/usr/bin/env node
// We delegate to tsx so we can ship raw .ts source. Using the loader API
// directly broke between Node versions; spawning the tsx binary is portable.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'src', 'index.ts');
const tsxBin = resolve(here, '..', 'node_modules', '.bin', 'tsx');
const cmd = existsSync(tsxBin) ? tsxBin : 'tsx';

const child = spawn(cmd, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
