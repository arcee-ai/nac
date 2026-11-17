"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test(
  "Node fd3 is a connected Rust UnixStream and actual parent death closes it",
  { timeout: 15000 },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-electron-unix-"));
    const executable = path.join(root, "probe");
    let parent;
    try {
      const build = spawnSync(
        "rustc",
        [path.join(__dirname, "transport-probe.rs"), "-o", executable],
        { encoding: "utf8" },
      );
      assert.equal(build.status, 0, build.stderr);
      const marker = path.join(root, "eof");
      const code = `const{spawn}=require('node:child_process');const c=spawn(${JSON.stringify(executable)},[${JSON.stringify(marker)}],{stdio:['ignore','ignore','inherit','pipe']});c.stdio[3].on('data',()=>process.stdout.write('ready\\n'));c.stdio[3].write('parent-owned');`;
      parent = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
      await once(parent.stdout, "data");
      assert.equal(fs.existsSync(marker), false);
      parent.kill("SIGKILL");
      await once(parent, "exit");
      for (let n = 0; n < 100 && !fs.existsSync(marker); n++) await wait(25);
      assert.equal(fs.readFileSync(marker, "utf8"), "parent-owned");
    } finally {
      parent?.kill("SIGKILL");
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
