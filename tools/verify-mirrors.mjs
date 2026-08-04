import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicRoot = join(root, "public");
const docsRoot = join(root, "docs");
const githubBasePath = "/-snezhanna-portfolio";

const publicFiles = await listFiles(publicRoot);
const docsFiles = (await listFiles(docsRoot)).filter((file) => file !== ".nojekyll");
const errors = [];

for (const file of publicFiles) {
  if (!docsFiles.includes(file)) errors.push(`Missing in docs: ${file}`);
}

for (const file of docsFiles) {
  if (!publicFiles.includes(file)) errors.push(`Only in docs: ${file}`);
}

for (const file of publicFiles.filter((entry) => docsFiles.includes(entry))) {
  const publicContent = await readFile(join(publicRoot, file));
  const docsContent = await readFile(join(docsRoot, file));
  const extension = extname(file);

  if (extension === ".html" || extension === ".css") {
    const normalizedDocs = docsContent.toString("utf8").replaceAll(githubBasePath, "");
    if (publicContent.toString("utf8") !== normalizedDocs) {
      errors.push(`Content differs: ${file}`);
    }
  } else if (!publicContent.equals(docsContent)) {
    errors.push(`Binary content differs: ${file}`);
  }
}

if (errors.length > 0) {
  console.error("Deployment mirrors are out of sync:\n" + errors.join("\n"));
  process.exit(1);
}

console.log(`Deployment mirrors match: ${publicFiles.length} files checked`);

async function listFiles(directory) {
  const files = [];
  await walk(directory, files);
  return files.sort();

  async function walk(currentDirectory, output) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, output);
      } else {
        output.push(relative(directory, path));
      }
    }
  }
}
