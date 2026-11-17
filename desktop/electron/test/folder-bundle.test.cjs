"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildFolderBundle } = require("../scripts/folder-bundle.cjs");
const { folderExecutable } = require("../src/folder.cjs");

test("folder bundle has a native UI identity without changing direct executable custody", () => {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), "nac-folder-bundle-"));
  try {
    const calls = [];
    const folder = buildFolderBundle(
      resources,
      { track: "dev", product_version: "0.1.4" },
      (file, args) => calls.push({ file, args }),
    );
    const read = (key) =>
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, folder.plist], {
        encoding: "utf8",
      }).trim();
    assert.equal(read("CFBundleIdentifier"), "ai.arcee.nac.electron.folder-picker.dev");
    assert.equal(read("CFBundlePackageType"), "APPL");
    assert.equal(read("LSUIElement"), "true");
    assert.equal(read("CFBundleVersion"), "0.1.4");
    assert.equal(
      path.join(folder.bundle, "Contents", "MacOS", read("CFBundleExecutable")),
      folderExecutable(resources),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "/usr/bin/xcrun");
    assert.equal(calls[0].args[0], "swiftc");
    assert.equal(calls[0].args.at(-1), folder.executable);
  } finally {
    fs.rmSync(resources, { recursive: true });
  }
});
