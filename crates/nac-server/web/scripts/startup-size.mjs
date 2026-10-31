#!/usr/bin/env node
// Measures what a first paint has to download: the entry module, every chunk it
// reaches through static imports, and the stylesheets the page links. Lazy
// `import()` chunks are left out on purpose, so a budget can tell a startup
// regression from code that only loads with its workflow.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g;
const STATIC_EXPORT_FROM = /(?:^|[;\n}])\s*export\s*[\w*{}\s,$]+from\s*["']([^"']+)["']/g;

function gzipBytes(file) {
  return gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

function staticGraph(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of [STATIC_IMPORT, STATIC_EXPORT_FROM]) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        queue.push(path.resolve(path.dirname(file), specifier));
      }
    }
  }
  return [...seen];
}

function report(name, root, scripts, styles) {
  const files = [
    ...staticGraph(scripts).map((file) => ({ kind: "js", file })),
    ...styles.map((file) => ({ kind: "css", file })),
  ].map(({ kind, file }) => ({
    kind,
    file: path.relative(root, file),
    bytes: fs.statSync(file).size,
    gzip: gzipBytes(file),
  }));
  const total = (kind) =>
    files.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.gzip, 0);
  return {
    name,
    jsGzip: total("js"),
    cssGzip: total("css"),
    files: files.sort((a, b) => b.gzip - a.gzip),
  };
}

function appReport() {
  const root = path.resolve(web, "../assets/dist");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const local = (url) => path.join(root, url.replace(/^\/assets\/dist\//, ""));
  const scripts = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) =>
    local(m[1]),
  );
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(
    (m) => local(m[1]),
  );
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) =>
    local(m[1]),
  );
  return report("app", root, [...scripts, ...preloads], styles);
}

function presentationReport() {
  const root = path.resolve(web, "packages/nac-presentation/dist");
  return report(
    "presentation",
    root,
    [path.join(root, "index.js")],
    [path.join(root, "styles.css")],
  );
}

const reports = [appReport(), presentationReport()];
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
} else {
  for (const entry of reports) {
    const kib = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;
    process.stdout.write(
      `${entry.name}: startup JS ${kib(entry.jsGzip)} gzip, CSS ${kib(entry.cssGzip)} gzip\n`,
    );
    for (const file of entry.files) {
      process.stdout.write(`  ${file.kind} ${kib(file.gzip).padStart(12)}  ${file.file}\n`);
    }
  }
}
