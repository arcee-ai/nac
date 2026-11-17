#!/usr/bin/env node
"use strict";

// Development-only bundle writer. Electron documents Resources/app as a
// supported distribution layout; no globally installed packaging tool is used.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { buildFolderBundle } = require("./folder-bundle.cjs");
const owner = path.resolve(__dirname, "..");
const root = path.resolve(owner, "../..");
const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  }).trim();
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function inventory(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Source inventory refuses symlinks");
      return entry.isDirectory()
        ? inventory(file)
        : [{ path: path.relative(root, file), sha256: digest(file) }];
    });
}
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This development package requires Apple Silicon macOS");
}
const engine = path.resolve(
  process.env.NAC_ELECTRON_ENGINE || path.join(root, "target/release/nac-web"),
);
const identity = JSON.parse(run(engine, ["__desktop-identity"]));
if (identity.build_id.startsWith("native-auth-fixture-"))
  throw new Error("Normal package refuses fixture engine");
const sourceRevision = run("git", ["rev-parse", "HEAD"]);
const productVersion = fs.readFileSync(path.join(root, "version.txt"), "utf8").trim();
if (identity.source_revision !== sourceRevision || identity.product_version !== productVersion) {
  throw new Error(
    "The engine does not match this checkout revision/version. Rebuild the locked release engine before packaging.",
  );
}
const changedInputs = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=normal",
  "--",
  "crates",
  "Cargo.toml",
  "Cargo.lock",
  "version.txt",
  "scripts/build-identity.rs",
  "desktop/electron/src",
  "desktop/electron/scripts",
  "desktop/electron/package.json",
  "desktop/electron/package-lock.json",
]);
if (changedInputs)
  throw new Error("Commit the runtime and packaging inputs before creating a review candidate.");
const schemaSource = fs.readFileSync(
  path.join(root, "crates/nac-core/src/store/schema.rs"),
  "utf8",
);
const schema = Number(schemaSource.match(/const STORE_SCHEMA_VERSION: i64 = (\d+);/)?.[1]);
if (!schema) throw new Error("Cannot determine exact engine schema");
const output = path.resolve(process.env.NAC_ELECTRON_OUTPUT || path.join(root, "target/electron"));
const app = path.join(output, "NAC Electron.app");
// Never replace an existing candidate implicitly: caller selects a new output
// directory or explicitly removes only its own previously settled build.
if (fs.existsSync(app)) throw new Error(`Output already exists: ${app}`);
fs.mkdirSync(output, { recursive: true });
// The locked Electron package lazily fetches its checksum-verified runtime on
// first require when npm's installation-script policy deferred that download.
const vendorExecutable = require("electron");
const runtime = JSON.parse(
  run(vendorExecutable, ["-p", "JSON.stringify(process.versions)"], {
    env: { PATH: "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" },
  }),
);
const electron = path.join(owner, "node_modules/electron/dist/Electron.app");
run("/usr/bin/ditto", [electron, app]);
const contents = path.join(app, "Contents");
// Electron's packaged/development classification depends on the executable's
// product name on macOS. Retaining `Electron` incorrectly selects dev resources.
fs.renameSync(path.join(contents, "MacOS/Electron"), path.join(contents, "MacOS/NAC"));
const resources = path.join(contents, "Resources");
fs.rmSync(path.join(resources, "default_app.asar"), { force: true });
const application = path.join(resources, "app");
fs.mkdirSync(application);
fs.cpSync(path.join(owner, "src"), path.join(application, "src"), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(owner, "package.json"), "utf8"));
if (runtime.electron !== pkg.devDependencies.electron)
  throw new Error("Runtime differs from the locked Electron version");
fs.writeFileSync(
  path.join(application, "package.json"),
  JSON.stringify(
    {
      name: pkg.name,
      version: identity.product_version,
      main: "src/main.cjs",
      private: true,
    },
    null,
    2,
  ) + "\n",
);
fs.copyFileSync(engine, path.join(resources, "nac-web"));
fs.chmodSync(path.join(resources, "nac-web"), 0o755);
const folder = buildFolderBundle(resources, identity, run);
for (const name of ["engine-launcher", "checkpoint-helper"]) {
  run("/usr/bin/xcrun", [
    "clang",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-mmacosx-version-min=14.0",
    path.join(owner, `src/${name}.c`),
    "-o",
    path.join(resources, name),
  ]);
}
fs.writeFileSync(
  path.join(resources, "engine-identity.json"),
  JSON.stringify(identity, null, 2) + "\n",
);
fs.copyFileSync(path.join(root, "LICENSE"), path.join(resources, "NAC-LICENSE"));
// Keep Electron's LICENSE and Chromium notices with the copied framework.
for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
  const source = path.join(owner, "node_modules/electron/dist", name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(resources, `Electron-${name}`));
}
const plist = path.join(contents, "Info.plist");
for (const [key, value] of Object.entries({
  CFBundleIdentifier: `ai.arcee.nac.electron.${identity.track}`,
  CFBundleExecutable: "NAC",
  CFBundleName: "NAC Electron",
  CFBundleDisplayName: "NAC Electron",
  CFBundleShortVersionString: identity.product_version,
  CFBundleVersion: identity.product_version,
}))
  run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
// The vendor archive contains nested executable code. Re-sign inside out for
// this ad-hoc development identity before sealing the outer application.
function signVendor(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      signVendor(file);
      if (entry.name.endsWith(".app") || entry.name.endsWith(".framework")) {
        run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
      }
    } else if (entry.isFile()) {
      const descriptor = fs.openSync(file, "r");
      const header = Buffer.alloc(4);
      const length = fs.readSync(descriptor, header, 0, 4, 0);
      fs.closeSync(descriptor);
      if (
        length === 4 &&
        ["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "bebafeca"].includes(
          header.toString("hex"),
        )
      ) {
        run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
      }
    }
  }
}
signVendor(path.join(contents, "Frameworks"));
// Sign owned executables before hashing their final bytes. Signing the outer
// bundle afterward must not rewrite those manifest-bound resources.
for (const file of [
  path.join(resources, "nac-web"),
  folder.executable,
  path.join(resources, "engine-launcher"),
  path.join(resources, "checkpoint-helper"),
]) {
  run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
}
run("/usr/bin/codesign", ["--force", "--sign", "-", folder.bundle]);
const manifest = {
  version: 1,
  kind: "local-macos-development",
  sourceRevision,
  engine_identity: identity,
  schema,
  architecture: process.arch,
  electron: pkg.devDependencies.electron,
  runtime,
  engineSha256: digest(path.join(resources, "nac-web")),
  engineInputSha256: digest(engine),
  folderPickerSha256: digest(folder.executable),
  folderPicker: {
    identifier: folder.identifier,
    bundle: path.relative(resources, folder.bundle),
    executable: path.relative(resources, folder.executable),
    infoSha256: digest(folder.plist),
  },
  engineLauncherSha256: digest(path.join(resources, "engine-launcher")),
  checkpointHelperSha256: digest(path.join(resources, "checkpoint-helper")),
  shell: inventory(path.join(owner, "src")),
  assets: inventory(path.join(root, "crates/nac-server/assets/dist")),
  packageLockSha256: digest(path.join(owner, "package-lock.json")),
  signing: "ad-hoc; no notarization or public distribution qualification",
};
fs.writeFileSync(path.join(resources, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
run("/usr/bin/codesign", ["--force", "--sign", "-", app]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
console.log(app);
