#!/usr/bin/env node
// Inspect and preserve the root tarball. This receipt is artifact provenance,
// never a substitute for browser journeys or human visual acceptance.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "../../..");
const presentation = "crates/nac-server/web/packages/nac-presentation/dist/";
const run = (command, args, cwd = repository) =>
  execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export function assetPath(name) {
  assert.equal(typeof name, "string", "asset path must be a string");
  assert(name.startsWith("assets/"), `asset is outside assets/: ${name}`);
  assert(!name.includes("\\"), `asset uses a backslash: ${name}`);
  assert(
    !name.split("/").some((part) => !part || part === "." || part === ".."),
    `asset path is not canonical: ${name}`,
  );
  return name;
}

export function inspectManifest(manifest, files) {
  assert(Array.isArray(manifest.assets) && manifest.assets.length, "empty asset inventory");
  assert(
    Array.isArray(manifest.mathjaxFonts) && manifest.mathjaxFonts.length,
    "empty MathJax fonts",
  );
  assert.equal(new Set(manifest.assets).size, manifest.assets.length, "duplicate asset paths");
  const paths = new Set(files);
  for (const name of manifest.assets) {
    assetPath(name);
    assert(paths.has(presentation + name), `asset missing from tarball: ${name}`);
  }
  for (const name of manifest.mathjaxFonts) {
    assert(manifest.assets.includes(name), `font missing from asset inventory: ${name}`);
    assert(name.includes("/fonts/") && /\.woff2?$/.test(name), `unexpected font path: ${name}`);
  }
  for (const name of paths) {
    if (name.startsWith(presentation + "assets/"))
      assert(
        manifest.assets.includes(name.slice(presentation.length)),
        `unlisted packed asset: ${name}`,
      );
  }
}

export function inspectExports(exports, files) {
  const paths = new Set(files);
  const targets = (value) =>
    typeof value === "string" ? [value] : Object.values(value).flatMap(targets);
  for (const key of [
    ".",
    "./client",
    "./stream",
    "./presentation",
    "./presentation/styles.css",
    "./presentation/assets.json",
    "./presentation/assets/*",
  ])
    assert(key in exports, `missing public export: ${key}`);
  for (const [key, entry] of Object.entries(exports)) {
    for (const target of targets(entry)) {
      assert(target.startsWith("./") && !target.split("/").includes(".."), `unsafe export: ${key}`);
      if (target.includes("*")) {
        const [prefix, suffix] = target.slice(2).split("*");
        assert(
          [...paths].some((name) => name.startsWith(prefix) && name.endsWith(suffix)),
          `empty export pattern: ${key}`,
        );
      } else assert(paths.has(target.slice(2)), `export missing from tarball: ${key} -> ${target}`);
    }
  }
  assert(exports["./presentation"].types?.endsWith(".d.ts"), "presentation types are not exported");
  assert(exports["./presentation"].import?.endsWith(".js"), "presentation module is not exported");
}

function main() {
  const { values } = parseArgs({
    options: { output: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: node scripts/presentation-artifact.mjs --output /absolute/evidence/directory\n" +
        "Run after the normal production build, with clean committed source and outputs. Packs twice, preserves\n" +
        "the exact tarball, checks exports/assets/fonts, and records hashes/toolchain/startup graphs.\n" +
        "Does not build, publish, install peers, run browsers, or certify visual acceptance.\n",
    );
    return;
  }
  assert(values.output && path.isAbsolute(values.output), "--output must be an absolute directory");
  const output = path.resolve(values.output);
  assert(
    output !== repository && !output.startsWith(repository + path.sep),
    "keep evidence outside source checkout",
  );
  assert(
    !fs.existsSync(path.join(output, "artifact.json")),
    "use a new evidence directory; preserve prior receipts",
  );
  assert.equal(
    run("git", ["status", "--porcelain"]),
    "",
    "commit coherent source and package inputs before recording provenance",
  );
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nac-presentation-artifact-"));
  try {
    const pack = (name) => {
      const destination = path.join(temporary, name);
      fs.mkdirSync(destination);
      const report = JSON.parse(
        run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination]),
      )[0];
      return { report, file: path.join(destination, report.filename) };
    };
    const first = pack("first"),
      second = pack("second");
    const bytes = fs.readFileSync(first.file);
    assert(bytes.equals(fs.readFileSync(second.file)), "tarball is not reproducible");
    assert.equal(first.report.integrity, second.report.integrity, "tarball integrity differs");
    const unpacked = path.join(temporary, "unpacked");
    fs.mkdirSync(unpacked);
    run("tar", ["-xzf", first.file, "-C", unpacked]);
    const root = path.join(unpacked, "package");
    const read = (name) => fs.readFileSync(path.join(root, name));
    const pkg = JSON.parse(read("package.json"));
    const files = first.report.files.map((file) => file.path).sort();
    inspectExports(pkg.exports, files);
    const assets = JSON.parse(read(presentation + "assets.json"));
    inspectManifest(assets, files);
    for (const name of ["lucide", "xterm", "radix-ui", "floating-ui", "shadcn-ui"])
      assert(files.includes(presentation + `licenses/${name}.txt`), `missing notice: ${name}`);
    const inventory = files.map((file) => ({
      file,
      bytes: read(file).length,
      sha256: sha256(read(file)),
    }));
    const graphs = JSON.parse(
      run(process.execPath, [path.join(web, "scripts/startup-size.mjs"), "--json"]),
    );
    const receipt = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      revision: run("git", ["rev-parse", "HEAD"]),
      package: {
        name: pkg.name,
        version: pkg.version,
        filename: first.report.filename,
        integrity: first.report.integrity,
        sha256: sha256(bytes),
        bytes: bytes.length,
      },
      toolchain: {
        node: process.version,
        npm: run("npm", ["--version"]),
        zlib: process.versions.zlib,
        platform: process.platform,
        arch: process.arch,
        gzipLevel: 9,
      },
      lockfileSha256: sha256(fs.readFileSync(path.join(web, "package-lock.json"))),
      exports: pkg.exports,
      peers: pkg.peerDependencies,
      optionalPeers: pkg.peerDependenciesMeta,
      sideEffects: pkg.sideEffects,
      assets,
      inventory,
      startupGraphs: graphs,
      acceptance:
        "Artifact provenance only. Attach selected slice revisions, browser journey/capture results, cumulative budget comparison and explicit environment gaps before qualification.",
    };
    fs.copyFileSync(
      first.file,
      path.join(output, first.report.filename),
      fs.constants.COPYFILE_EXCL,
    );
    fs.writeFileSync(path.join(output, "artifact.json"), JSON.stringify(receipt, null, 2) + "\n", {
      flag: "wx",
    });
    process.stdout.write(
      `${receipt.revision} ${receipt.package.sha256}\n${path.join(output, "artifact.json")}\n`,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
