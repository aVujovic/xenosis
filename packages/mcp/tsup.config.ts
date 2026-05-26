import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: './dist',
  clean: true,
  bundle: true,
  splitting: false,
  dts: true,
  sourcemap: false,
  minify: false,
  // Preserve the shebang on dist/index.js so the bin is directly executable.
  banner: { js: '#!/usr/bin/env node' },
  external: ['@modelcontextprotocol/sdk', 'zod', 'glob'],
});
