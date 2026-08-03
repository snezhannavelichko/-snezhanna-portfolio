import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(process.env.PORTFOLIO_SOURCE || path.join(repoRoot, "../портфолио"));
const outputRoot = path.join(repoRoot, "public");

const pages = [
  { source: "index.html", output: "index.html", route: "/" },
  { source: "case-flow-purchase-free-flow-variant.html", output: "purchase-flow/index.html", route: "/purchase-flow/" },
  { source: "case-app-redesign.html", output: "app-redesign/index.html", route: "/app-redesign/" },
  { source: "case-career-navigator.html", output: "career-navigator/index.html", route: "/career-navigator/" }
];

const routeBySource = new Map(pages.map((page) => [page.source, page.route]));
const linkedInUrl = "https://www.linkedin.com/in/snezhanna-velichko-a382a1275/";
const assetByDigest = new Map();
const copiedAssets = [];

function hasClass(openingTag, className) {
  const match = openingTag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
  return Boolean(match && match[1].split(/\s+/).includes(className));
}

function removeSectionsByClass(html, classNames) {
  let result = html;
  let changed = true;

  while (changed) {
    changed = false;
    const openingPattern = /<section\b[^>]*>/gi;
    let opening;

    while ((opening = openingPattern.exec(result))) {
      if (!classNames.some((className) => hasClass(opening[0], className))) continue;

      const tokenPattern = /<section\b[^>]*>|<\/section\s*>/gi;
      tokenPattern.lastIndex = opening.index;
      let depth = 0;
      let token;

      while ((token = tokenPattern.exec(result))) {
        if (/^<section\b/i.test(token[0])) depth += 1;
        else depth -= 1;

        if (depth === 0) {
          result = result.slice(0, opening.index) + result.slice(tokenPattern.lastIndex);
          changed = true;
          break;
        }
      }

      if (!changed) {
        throw new Error(`Could not remove legacy section: ${opening[0]}`);
      }
      break;
    }
  }

  return result;
}

function stripQueryAndHash(value) {
  return value.split(/[?#]/, 1)[0];
}

function isExternal(value) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(value);
}

function decodeLocalPath(value) {
  const clean = stripQueryAndHash(value);
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

async function copyHashedAsset(sourcePath) {
  const buffer = await readFile(sourcePath);
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const extension = path.extname(sourcePath).toLowerCase();
  const key = `${digest}${extension}`;

  if (!assetByDigest.has(key)) {
    const relativeOutput = `assets/media/${key}`;
    const outputPath = path.join(outputRoot, relativeOutput);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buffer);
    assetByDigest.set(key, `/${relativeOutput}`);
    copiedAssets.push({ sourcePath, outputPath, bytes: buffer.byteLength });
  }

  return assetByDigest.get(key);
}

async function exportFonts() {
  const fontsRoot = path.join(sourceRoot, "assets/fonts");
  const fontFiles = [
    ["Inter-Regular.ttf", "inter-400.ttf"],
    ["Inter-Medium.ttf", "inter-500.ttf"],
    ["Inter-SemiBold.ttf", "inter-600.ttf"],
    ["Inter-Bold.ttf", "inter-700.ttf"]
  ];

  await mkdir(path.join(outputRoot, "assets/fonts"), { recursive: true });
  for (const [sourceName, outputName] of fontFiles) {
    await cp(path.join(fontsRoot, sourceName), path.join(outputRoot, "assets/fonts", outputName));
  }

  const css = `@font-face{font-family:"Inter";src:url("/assets/fonts/inter-400.ttf") format("truetype");font-style:normal;font-weight:400;font-display:swap}\n` +
    `@font-face{font-family:"Inter";src:url("/assets/fonts/inter-500.ttf") format("truetype");font-style:normal;font-weight:500;font-display:swap}\n` +
    `@font-face{font-family:"Inter";src:url("/assets/fonts/inter-600.ttf") format("truetype");font-style:normal;font-weight:600;font-display:swap}\n` +
    `@font-face{font-family:"Inter";src:url("/assets/fonts/inter-700.ttf") format("truetype");font-style:normal;font-weight:700;font-display:swap}\n`;
  await mkdir(path.join(outputRoot, "assets/styles"), { recursive: true });
  await writeFile(path.join(outputRoot, "assets/styles/fonts.css"), css);
}

async function rewriteAssetReferences(html, sourceFile) {
  const scriptIndex = html.search(/<script\b/i);
  const markup = scriptIndex === -1 ? html : html.slice(0, scriptIndex);
  const scripts = scriptIndex === -1 ? "" : html.slice(scriptIndex);
  const attributePattern = /((?:src|href|data-fullscreen-src)\s*=\s*["'])([^"']+)(["'])/gi;
  const matches = [...markup.matchAll(attributePattern)];
  const cssUrlMatches = [...markup.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)];
  const replacements = new Map();

  const values = new Set([
    ...matches.map((match) => match[2]),
    ...cssUrlMatches.map((match) => match[1])
  ]);

  for (const value of values) {
    if (isExternal(value) || value === "/" || value.endsWith("/")) continue;
    if (routeBySource.has(stripQueryAndHash(value))) continue;
    if (decodeLocalPath(value) === "assets/fonts/portfolio-fonts.css") {
      replacements.set(value, "/assets/styles/fonts.css");
      continue;
    }

    const localPath = path.resolve(path.dirname(path.join(sourceRoot, sourceFile)), decodeLocalPath(value));
    if (!localPath.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Asset escapes source root in ${sourceFile}: ${value}`);
    }
    if (!existsSync(localPath) || !(await stat(localPath)).isFile()) {
      throw new Error(`Missing production asset in ${sourceFile}: ${value}`);
    }
    replacements.set(value, await copyHashedAsset(localPath));
  }

  let rewrittenMarkup = markup;
  for (const [before, after] of replacements) {
    rewrittenMarkup = rewrittenMarkup.split(before).join(after);
  }
  return rewrittenMarkup + scripts;
}

function rewriteNavigation(html) {
  for (const [source, route] of routeBySource) {
    html = html.replaceAll(`href="${source}"`, `href="${route}"`);
    html = html.replaceAll(`href='${source}'`, `href='${route}'`);
  }
  return html;
}

function preparePage(html, page) {
  html = html.replaceAll("https://www.linkedin.com/", linkedInUrl);
  html = rewriteNavigation(html);

  if (page.source === "case-flow-purchase-free-flow-variant.html") {
    html = removeSectionsByClass(html, [
      "tariff-block",
      "tariff-legacy-export",
      "tariff-stage",
      "free-part",
      "checkout-part"
    ]);
    html = html.replace(
      /background:\s*#cdc7c2\s+url\([^)]+figma-checkout-landscape-bg\.png[^)]*\)\s+center\s*\/\s*cover\s+no-repeat;/g,
      "background: #cdc7c2;"
    );
  }

  const robotsMeta = '<meta name="robots" content="noindex, nofollow, noarchive" />';
  if (!/<meta\s+name=["']robots["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `  ${robotsMeta}\n</head>`);
  }
  return html;
}

async function exportPage(page) {
  const sourcePath = path.join(sourceRoot, page.source);
  let html = await readFile(sourcePath, "utf8");
  html = preparePage(html, page);
  html = await rewriteAssetReferences(html, page.source);

  const outputPath = path.join(outputRoot, page.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
}

async function writePlatformFiles() {
  const headers = `https://:project.pages.dev/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n\nhttps://:version.:project.pages.dev/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
  await writeFile(path.join(outputRoot, "_headers"), headers);
  await writeFile(path.join(outputRoot, "robots.txt"), "User-agent: *\nDisallow: /\n");

  const notFound = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Страница не найдена</title><link rel="stylesheet" href="/assets/styles/fonts.css"><style>html{font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;color:#202020}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{max-width:560px}h1{font-size:40px;line-height:1.1;margin:0 0 16px}p,a{font-size:19px;line-height:26px}a{color:inherit}</style></head><body><main><h1>Страница не найдена</h1><p>Такой страницы нет или она была перемещена.</p><a href="/">Вернуться на главную</a></main></body></html>`;
  await writeFile(path.join(outputRoot, "404.html"), notFound);
}

async function main() {
  for (const page of pages) {
    if (!existsSync(path.join(sourceRoot, page.source))) {
      throw new Error(`Missing production source: ${page.source}`);
    }
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await exportFonts();
  for (const page of pages) await exportPage(page);
  await writePlatformFiles();

  const totalBytes = copiedAssets.reduce((sum, asset) => sum + asset.bytes, 0);
  console.log(`Exported ${pages.length} pages and ${copiedAssets.length} unique media assets (${(totalBytes / 1024 / 1024).toFixed(1)} MiB).`);
}

await main();
