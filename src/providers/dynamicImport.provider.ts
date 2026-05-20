import { sync as globSync } from 'glob';
import { workerData } from 'node:worker_threads';
import path from 'node:path';
import url from 'node:url';

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
    const modulePaths = globSync(path.join(dir, pattern));

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
