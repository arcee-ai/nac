"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { Engine } = require("../src/engine.cjs");
const { selectConfiguration, options } = require("../src/configuration.cjs");
const executable =
  process.env.NAC_ELECTRON_ENGINE || path.resolve(__dirname, "../../../target/release/nac-web");
const schema = Number(
  fs
    .readFileSync(path.resolve(__dirname, "../../../crates/nac-core/src/store/schema.rs"), "utf8")
    .match(/const STORE_SCHEMA_VERSION: i64 = (\d+);/)[1],
);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function fixture() {
  assert.ok(
    fs.existsSync(executable),
    "Build target/release/nac-web before the real-engine controls",
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-electron-engine-"));
  const launcher = path.join(directory, "engine-launcher");
  execFileSync("cc", [
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    path.resolve(__dirname, "../src/engine-launcher.c"),
    "-o",
    launcher,
  ]);
  for (const name of ["home", "config", "workspace"]) fs.mkdirSync(path.join(directory, name));
  const identity = JSON.parse(execFileSync(executable, ["__desktop-identity"]));
  const configuration = await selectConfiguration(
    executable,
    identity,
    options([
      "--directory",
      path.join(directory, "workspace"),
      "--store-path",
      path.join(directory, "store.db"),
    ]),
    {
      HOME: path.join(directory, "home"),
      NAC_HOME: path.join(directory, "config"),
      PATH: "/usr/bin:/bin",
      MODELS_DEV_URL: "http://127.0.0.1:1",
    },
  );
  return { directory, executable, identity, schema, configuration, launcher };
}
function start(fixture) {
  const engine = new Engine(fixture);
  return {
    engine,
    ready: new Promise((resolve, reject) => {
      engine.once("ready", resolve);
      engine.once("failure", reject);
      engine.launch();
    }),
  };
}
test(
  "real release engine enforces occupied store, future schema and owned settlement",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const launches = [];
    try {
      const first = start(f);
      launches.push(first.engine);
      const receipt = await first.ready;
      assert.equal(receipt.store, f.configuration.store);
      assert.equal(receipt.schema, schema);
      const second = start(f);
      launches.push(second.engine);
      await assert.rejects(second.ready, (error) => error.code === "store_owned");
      await second.engine.stop();
      assert.equal(second.engine.exited, true);
      assert.equal(first.engine.receipt.incarnation, receipt.incarnation);
      await first.engine.stop();
      assert.equal(first.engine.exited, true);
      execFileSync("python3", [
        "-c",
        'import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute("PRAGMA user_version=999");c.close()',
        f.configuration.store,
      ]);
      const future = start(f);
      launches.push(future.engine);
      await assert.rejects(future.ready, (error) => error.code === "store_schema_incompatible");
      await future.engine.stop();
      const version = execFileSync(
        "python3",
        [
          "-c",
          'import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("PRAGMA user_version").fetchone()[0])',
          f.configuration.store,
        ],
        { encoding: "utf8" },
      );
      assert.equal(version.trim(), "999");
    } finally {
      await Promise.all(launches.map((engine) => engine.stop()));
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
test(
  "failed Rust spawn terminal fact is acknowledged before helper reap",
  { timeout: 10000 },
  async () => {
    const f = await fixture();
    const { engine, ready } = start({ ...f, executable: path.join(f.directory, "absent") });
    const channel = engine.child.stdio[3],
      custody = engine.child.stdio[4];
    channel.pause();
    custody.pause();
    let buffered;
    const terminalBuffered = new Promise((resolve) => {
      // Retain the listener until explicit resume; removing a once-listener
      // would let the existing data handler consume and ACK the queued fact.
      buffered = resolve;
      custody.on("readable", buffered);
    });
    // Keep the rejection observed even if a preceding wire assertion fails.
    void ready.catch(() => {});
    try {
      // The terminal fact is buffered, but no receipt or EOF ACK has reached
      // Engine. Probe the actual socket without consuming bytes: the failed
      // spawn must retain its launch peer until that exact ACK, independent
      // of which native descriptor Node would otherwise service first.
      await terminalBuffered;
      assert.equal(engine.custodySettled, false);
      const probe = spawn(
        "python3",
        [
          "-c",
          "import socket,sys\ns=socket.socket(fileno=3)\ntry: s.recv(1,socket.MSG_PEEK|socket.MSG_DONTWAIT)\nexcept BlockingIOError: sys.exit(0)\nsys.exit(1)",
        ],
        { stdio: ["ignore", "pipe", "pipe", channel] },
      );
      const [probeCode, probeSignal] = await once(probe, "close");
      assert.equal(probeSignal, null);
      assert.equal(probeCode, 0, "launch peer must remain open until the failed fact is ACKed");
      assert.equal(engine.custodySettled, false);
      assert.equal(engine.helperClosed, false);
      assert.equal(engine.failed, false);
      custody.off("readable", buffered);
      custody.resume();
      channel.resume();
      await assert.rejects(ready, (error) => error.code === "engine_spawn");
      await engine.stop();
      assert.equal(engine.custodySettled, true);
      assert.equal(engine.helperClosed, true);
      assert.equal(engine.exited, true);
      assert.equal(engine.child.stdio[4].writableEnded, true);
      assert.equal(engine.child.exitCode, 70);
      assert.equal(engine.enginePid, 0);
    } finally {
      custody.off("readable", buffered);
      custody.resume();
      channel.resume();
      await engine.stop();
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
for (const invalid of [false, true])
  test(
    `helper reap with ${invalid ? "invalid" : "missing"} terminal proof never proves settlement`,
    { timeout: 10000 },
    async () => {
      const f = await fixture();
      let launcher = "/usr/bin/true";
      if (invalid) {
        launcher = path.join(f.directory, "invalid-helper");
        const receipt = '{"kind":"failed","pid":0}\n{"extra":true}\n';
        execFileSync("cc", ["-x", "c", "-", "-o", launcher], {
          input: `#include <unistd.h>\nint main(void){write(4,${JSON.stringify(receipt)},${Buffer.byteLength(receipt)});return 0;}`,
        });
      }
      const { engine, ready } = start({ ...f, launcher });
      try {
        await assert.rejects(ready);
        await once(engine.child, "close");
        let resolved = false;
        void engine.stop().then(() => {
          resolved = true;
        });
        await wait(50);
        assert.equal(engine.helperClosed, true);
        assert.equal(engine.custodySettled, false);
        assert.equal(engine.exited, false);
        assert.equal(resolved, false);
        assert.equal(engine.child.stdio[4].writableEnded, false);
      } finally {
        fs.rmSync(f.directory, { recursive: true, force: true });
      }
    },
  );
test(
  "actual Node parent death retires real Rust engine without another PID signal",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let parent, pid, helperPid;
    try {
      const modulePath = path.resolve(__dirname, "../src/engine.cjs");
      const script = `const{Engine}=require(${JSON.stringify(modulePath)});const engine=new Engine(${JSON.stringify(f)});engine.once('ready',()=>process.stdout.write(JSON.stringify({pid:engine.pid,helperPid:engine.child.pid})+'\\n'));engine.once('failure',()=>engine.stop());engine.launch();`;
      parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
      const [bytes] = await once(parent.stdout, "data");
      ({ pid, helperPid } = JSON.parse(bytes));
      parent.kill("SIGKILL");
      await once(parent, "exit");
      for (const owned of [pid, helperPid]) {
        let alive = true;
        for (let i = 0; i < 200 && alive; i++) {
          try {
            process.kill(owned, 0);
            await wait(25);
          } catch {
            alive = false;
          }
        }
        assert.equal(alive, false, "engine and custody helper must exit from private parent EOF");
      }
    } finally {
      parent?.kill("SIGKILL");
      if (pid) {
        try {
          process.kill(pid, 0);
          throw new Error("Retaining fixture because exact orphan engine still exists");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  },
);
