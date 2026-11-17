"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");

test("package writer rejects a stale engine revision or product before creating any artifact", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nac-package-provenance-"));
  const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const version = fs.readFileSync(path.join(root, "version.txt"), "utf8").trim();
  try {
    for (const [index, sourceRevision, productVersion] of [
      [0, "0".repeat(40), version],
      [1, source, "999.0.0"],
    ]) {
      const engine = path.join(temporary, "engine-" + index);
      const identity = {
        source_revision: sourceRevision,
        product_version: productVersion,
        build_id: "fixture",
        track: "dev",
      };
      fs.writeFileSync(
        engine,
        `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(identity))});\n`,
        { mode: 0o700 },
      );
      const output = path.join(temporary, "output-" + index);
      const result = spawnSync(
        process.execPath,
        [path.join(root, "desktop/electron/scripts/package.cjs")],
        {
          env: { ...process.env, NAC_ELECTRON_ENGINE: engine, NAC_ELECTRON_OUTPUT: output },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /does not match this checkout revision\/version/);
      assert.equal(fs.existsSync(output), false);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
