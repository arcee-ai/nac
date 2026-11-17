"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-electron-custody-"));
  const launcher = path.join(directory, "launcher"),
    probe = path.join(directory, "probe");
  execFileSync("cc", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    process.env.NAC_ELECTRON_CUSTODY_SOURCE || path.resolve(__dirname, "../src/engine-launcher.c"),
    "-o",
    launcher,
  ]);
  execFileSync("cc", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    path.join(__dirname, "custody-probe.c"),
    "-o",
    probe,
  ]);
  const helper = spawn(launcher, [probe], { stdio: ["ignore", "pipe", "inherit", "pipe", "pipe"] });
  const spawned = once(helper.stdio[4], "data"),
    descendant = once(helper.stdout, "data");
  const [[receipt], [pid]] = await Promise.all([spawned, descendant]);
  return {
    directory,
    helper,
    engine: JSON.parse(receipt).pid,
    descendant: Number(pid.toString().trim()),
  };
}
async function gone(pid) {
  for (let i = 0; i < 200; i++) {
    try {
      process.kill(pid, 0);
      await wait(10);
    } catch {
      return true;
    }
  }
  return false;
}
async function settled(f) {
  let records = "";
  f.helper.stdio[4].on("data", (bytes) => {
    records += bytes.toString();
    if (records.includes('"kind":"settled"')) f.helper.stdio[4].end();
  });
  await once(f.helper, "close");
  assert.match(records, /"kind":"settled"/);
  assert.equal(await gone(f.engine), true);
  assert.equal(await gone(f.descendant), true);
  fs.rmSync(f.directory, { recursive: true, force: true });
}
test(
  "abrupt exact engine exit kills ordinary descendant before custody reap",
  { timeout: 10000 },
  async () => {
    const f = await fixture();
    const settlement = settled(f);
    process.kill(f.engine, "SIGKILL");
    await settlement;
  },
);
test(
  "delayed Unix custody reader preserves terminal proof across a late stop",
  { timeout: 10000 },
  async () => {
    const f = await fixture();
    const custody = f.helper.stdio[4];
    custody.pause();
    custody.on("error", () => {});
    const closed = once(f.helper, "close");
    let records = "";
    custody.on("data", (bytes) => {
      records += bytes.toString();
      if (records.includes('"kind":"settled"')) custody.end();
    });
    try {
      process.kill(f.engine, "SIGKILL");
      assert.equal(await gone(f.engine), true);
      assert.equal(await gone(f.descendant), true);
      // The leader has been reaped and settlement was written while Node's
      // reader was paused. A late stop must not reset that unread receipt.
      await wait(100);
      const error = await new Promise((resolve) => custody.write("stop\n", resolve));
      custody.resume();
      await closed;
      assert.equal(error, null);
      assert.deepEqual(JSON.parse(records), { kind: "settled", pid: f.engine });
      assert.equal(f.helper.exitCode, 0);
    } finally {
      custody.end();
      custody.resume();
      await closed;
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
test(
  "failed-spawn Unix terminal fact survives a delayed reader and late stop",
  { timeout: 10000 },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-electron-spawn-"));
    const launcher = path.join(directory, "launcher");
    execFileSync("cc", [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      process.env.NAC_ELECTRON_CUSTODY_SOURCE ||
        path.resolve(__dirname, "../src/engine-launcher.c"),
      "-o",
      launcher,
    ]);
    const helper = spawn(launcher, [path.join(directory, "absent")], {
      stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"],
    });
    const custody = helper.stdio[4];
    custody.pause();
    custody.on("error", () => {});
    const closed = once(helper, "close");
    let records = "";
    custody.on("data", (bytes) => {
      records += bytes.toString();
      if (records.includes('"kind":"failed"')) custody.end();
    });
    try {
      await wait(100);
      const error = await new Promise((resolve) => custody.write("stop\n", resolve));
      custody.resume();
      await closed;
      assert.equal(error, null);
      assert.deepEqual(JSON.parse(records), { kind: "failed", pid: 0 });
      assert.equal(helper.exitCode, 70);
    } finally {
      custody.end();
      custody.resume();
      await closed;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
test(
  "23-second fallback retains child custody and duplicate stop cannot shorten it",
  { timeout: 30000 },
  async () => {
    const f = await fixture();
    const settlement = settled(f),
      start = performance.now();
    f.helper.stdio[4].write("stop\n");
    await wait(100);
    f.helper.stdio[4].write("stop\n");
    process.kill(f.engine, 0);
    process.kill(f.descendant, 0);
    await settlement;
    assert.ok(
      performance.now() - start >= 23000,
      "native fallback must preserve full Rust settlement allowance",
    );
  },
);
