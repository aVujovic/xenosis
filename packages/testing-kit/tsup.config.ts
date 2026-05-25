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
  // Keep peers + runtime deps external — resolved from the consuming project.
  external: ['@xenosisorg/xenosis-core', '@electric-sql/pglite', 'supertest', 'awilix'],
});
