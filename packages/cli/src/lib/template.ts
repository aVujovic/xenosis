import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TokenMap = Record<string, string>;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the bundled `templates/` directory. Walking up from the module
 * location works in both layouts: dev runs from `src/lib/` (templates two
 * levels up) and the published package runs from `dist/` (templates one level
 * up). Resolving by search instead of a fixed `../../` keeps the build output
 * location decoupled from the templates location.
 */
function findTemplatesRoot(): string {
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'templates');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('[xenosis] could not locate the templates/ directory');
}

const TEMPLATES_ROOT = findTemplatesRoot();

/**
 * Copies a template directory to a destination, substituting {{tokens}} in
 * both file contents and filenames.
 *
 * Filename token convention: `{{name}}` in the source filename becomes the
 * matching token value. Same for path segments.
 *
 * Files ending in `.tmpl` have the suffix stripped after copy — used when the
 * template content is valid TypeScript but a literal name would conflict
 * with a real file in the CLI's own source.
 */
export async function copyTemplate(
  templateName: string,
  destination: string,
  tokens: TokenMap,
): Promise<string[]> {
  const src = resolve(TEMPLATES_ROOT, templateName);
  const written: string[] = [];
  await copyRecursive(src, destination, tokens, written);
  return written;
}

async function copyRecursive(
  src: string,
  dst: string,
  tokens: TokenMap,
  written: string[],
): Promise<void> {
  const stats = await stat(src);
  if (stats.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src);
    for (const entry of entries) {
      const tokenized = applyTokens(entry, tokens);
      await copyRecursive(join(src, entry), join(dst, tokenized), tokens, written);
    }
    return;
  }
  // File: read, substitute, write.
  const raw = await readFile(src, 'utf-8');
  const content = applyTokens(raw, tokens);
  let finalPath = dst;
  if (finalPath.endsWith('.tmpl')) finalPath = finalPath.slice(0, -'.tmpl'.length);
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, content, 'utf-8');
  written.push(relative(process.cwd(), finalPath));
}

function applyTokens(input: string, tokens: TokenMap): string {
  return input.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in tokens) return tokens[key]!;
    return `{{${key}}}`;
  });
}
