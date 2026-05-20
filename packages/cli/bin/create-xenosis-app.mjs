#!/usr/bin/env node
// `create-xenosis-app <name>` is an alias for `xenosis create-app <name>`.
// Spawn the compiled entry with the create-app subcommand injected.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '..', 'dist', 'index.js');

const child = spawn(
  process.execPath,
  [entry, 'create-app', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
