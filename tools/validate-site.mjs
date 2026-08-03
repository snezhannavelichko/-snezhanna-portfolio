import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "public");
const expectedHtml = new Set([
  "404.html",
  "index.html",
  "purchase-flow/index.html",
  "app-redesign/index.html",
  "career-navigator/index.html"
]);
const errors = [];
const referenced = new Set();

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else output.push(fullPath);
  }
  return output;
}

function relative(file) {
  return path.relative(publicRoot, file).split(path.sep).join("/");
}

function localTarget(fromFile, value) {
  const clean = value.split(/[?#]/, 1)[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(clean)) return null;
  if (clean === "/") return path.join(publicRoot, "index.html");
  if (clean.endsWith("/")) return path.join(publicRoot, clean, "index.html");
  return clean.startsWith("/")
    ? path.join(publicRoot, clean)
    : path.resolve(path.dirname(fromFile), clean);
}

function collectReference(fromFile, value) {
  const target = localTarget(fromFile, value);
  if (!target) return;
  if (!target.startsWith(publicRoot)) {
    errors.push(`${relative(fromFile)}: path escapes public directory: ${value}`);
    return;
  }
  if (!existsSync(target)) errors.push(`${relative(fromFile)}: missing reference: ${value}`);
  else referenced.add(relative(target));
}

if (!existsSync(publicRoot)) {
  throw new Error("public/ does not exist. Run npm run export first.");
}

const files = await walk(publicRoot);
for (const file of files) {
  const rel = relative(file);
  if (!/^[\x20-\x7E]+$/.test(rel)) errors.push(`Non-ASCII deployment path: ${rel}`);
  const info = await stat(file);
  if (info.size > 25 * 1024 * 1024) errors.push(`Cloudflare 25 MiB limit exceeded: ${rel}`);
}

const htmlFiles = files.filter((file) => file.endsWith(".html"));
for (const file of htmlFiles) {
  const rel = relative(file);
  if (!expectedHtml.has(rel)) errors.push(`Unexpected HTML page in deployment: ${rel}`);
  const html = await readFile(file, "utf8");
  const loadableMarkup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");

  if (!/<meta\s+name=["']robots["'][^>]+noindex/i.test(html)) errors.push(`${rel}: missing noindex meta tag`);
  if (html.includes("https://www.linkedin.com/\"") || html.includes("https://www.linkedin.com/'")) errors.push(`${rel}: LinkedIn placeholder remains`);
  if (/href=["'][^"']+\.html(?:[?#][^"']*)?["']/i.test(html)) errors.push(`${rel}: internal .html route remains`);
  if (/портфолио\/skills|case-flow-purchase-v1|case-app-redesign-gravity/i.test(html)) errors.push(`${rel}: draft or internal source reference leaked`);

  for (const match of loadableMarkup.matchAll(/(?:src|href|data-fullscreen-src)\s*=\s*["']([^"']+)["']/gi)) {
    collectReference(file, match[1]);
  }
  for (const match of loadableMarkup.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    collectReference(file, match[1]);
  }
}

const cssFiles = files.filter((file) => file.endsWith(".css"));
for (const file of cssFiles) {
  const css = await readFile(file, "utf8");
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    collectReference(file, match[1]);
  }
}

for (const file of files.filter((entry) => relative(entry).startsWith("assets/"))) {
  const rel = relative(file);
  if (!referenced.has(rel)) errors.push(`Unused deployment asset: ${rel}`);
}

for (const required of ["_headers", "robots.txt", ...expectedHtml]) {
  if (!existsSync(path.join(publicRoot, required))) errors.push(`Missing required output: ${required}`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce((a, b) => a + b, 0);
  console.log(`Validation passed: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, ${htmlFiles.length} HTML pages.`);
}
