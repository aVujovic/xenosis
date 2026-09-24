import { workerData } from 'node:worker_threads';
import path from 'node:path';
import url from 'node:url';
import { globFiles } from '../libs/globFiles';

type OnImportMeta = {
  dir: string;
  pattern: string;
  modulePath: string;
  relativePath: string;
};

type OnImport<T> = (mod: T, meta: OnImportMeta) => void | Promise<void>;

export default function createDynamicImporter({ logger }: { logger: any }) {
  async function dynamicImport<T = unknown>(
    pattern: string,
    onImport?: OnImport<T>,
  ): Promise<T[]> {
    const dir =
      (workerData as { cwd?: string } | undefined)?.cwd ?? process.cwd();
    logger.info(`🟢 Importing: ${dir}`);
    // Relative patterns resolve through glob's `cwd` — never `path.join`ed,
    // which would produce backslashes on Windows and match nothing.
    const modulePaths = globFiles([pattern], dir);

    return Promise.all(
      modulePaths.map(async (modulePath) => {
        const relativePath = path.relative(dir, modulePath);

        logger.info(`🟢 Importing: ${relativePath}`);

        const mod = (await import(url.pathToFileURL(modulePath).href)) as T;

        if (typeof onImport === 'function') {
          await onImport(mod, { dir, pattern, modulePath, relativePath });
        }

        return mod;
      }),
    );
  }

  return dynamicImport;
}
