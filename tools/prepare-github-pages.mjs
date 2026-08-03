import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "public");
const output = join(root, "docs");
const basePath = "/-snezhanna-portfolio";

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const files = await walk(output);
for (const file of files) {
  const extension = extname(file);
  if (extension !== ".html" && extension !== ".css") continue;

  const original = await readFile(file, "utf8");
  const rewritten = original
    .replace(/((?:href|src|data-fullscreen-src)=["'])\/(?!\/)/g, `$1${basePath}/`)
    .replace(/url\((["']?)\/(?!\/)/g, `url($1${basePath}/`);

  if (rewritten !== original) await writeFile(file, rewritten);
}

await writeFile(join(output, ".nojekyll"), "");
console.log(`Prepared GitHub Pages mirror in ${output}`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}
