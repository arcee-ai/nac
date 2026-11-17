#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { buildFolderBundle } = require("./folder-bundle.cjs");
const { launchPaths } = require("../src/configuration.cjs");
const root = path.resolve(__dirname, "../../..");
const { resources, executable: engine } = launchPaths({ packaged: false });
fs.mkdirSync(resources, { recursive: true });
const identity = JSON.parse(execFileSync(engine, ["__desktop-identity"], { encoding: "utf8" }));
const schema = Number(
  fs
    .readFileSync(path.join(root, "crates/nac-core/src/store/schema.rs"), "utf8")
    .match(/const STORE_SCHEMA_VERSION: i64 = (\d+);/)?.[1],
);
if (!schema) throw new Error("Cannot determine schema");
fs.writeFileSync(path.join(resources, "engine-identity.json"), JSON.stringify(identity) + "\n");
const engineSha256 = createHash("sha256").update(fs.readFileSync(engine)).digest("hex");
fs.writeFileSync(
  path.join(resources, "manifest.json"),
  JSON.stringify({ engine_identity: identity, schema, engineSha256 }) + "\n",
);
buildFolderBundle(resources, identity, (file, args) =>
  execFileSync(file, args, { stdio: "inherit" }),
);
execFileSync(
  "/usr/bin/xcrun",
  [
    "clang",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-mmacosx-version-min=14.0",
    path.join(root, "desktop/electron/src/engine-launcher.c"),
    "-o",
    path.join(resources, "engine-launcher"),
  ],
  { stdio: "inherit" },
);
console.log(resources);
