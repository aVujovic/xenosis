import { defineConfig } from 'tsup';

/**
 * OPTIONAL bundle config, used only by `xenosis build`. The default production
 * path runs from source with tsx (`pnpm start`) and needs none of this — reach
 * for a bundle only if you specifically want a single-file artifact.
 *
 * Workspace packages (Xenosis core + your `@scope/*` packages) are bundled
 * because plain Node can't import their .ts source from node_modules; real npm
 * deps stay external. pino spawns worker threads from its own files, so it must
 * not be bundled.
 */
const scopes = (process.env.XENOSIS_BUNDLE_SCOPES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const noExternal = ['@xenosisorg/', ...scopes].map(
  (s) => new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
);

export default defineConfig({
  entry: ['src/service.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  noExternal,
  external: ['pino', 'pino-pretty', 'express', 'awilix'],
  shims: true,
  banner: {
    js: "import { createRequire as _cr } from 'module'; const require = _cr(import.meta.url);",
  },
});
