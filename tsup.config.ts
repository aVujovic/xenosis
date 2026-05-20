import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: [],
  external: ['@prisma/client'],
  splitting: false,
  bundle: true,
  dts: true,
  outDir: './dist',
  target: 'es2022',
  clean: true,
  loader: { '.json': 'json' },
  minify: true,
  sourcemap: true,
});
