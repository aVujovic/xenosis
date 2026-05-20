#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'src', 'index.ts');
const tsxBin = resolve(here, '..', 'node_modules', '.bin', 'tsx');
const cmd = existsSync(tsxBin) ? tsxBin : 'tsx';

// Internal alias: xenosis create-app <name>
const child = spawn(cmd, [entry, 'create-app', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
