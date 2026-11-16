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
  "actual Node parent death retires real Rust engine without another PID signal",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let parent, pid;
    try {
      const modulePath = path.resolve(__dirname, "../src/engine.cjs");
      const script = `const{Engine}=require(${JSON.stringify(modulePath)});const engine=new Engine(${JSON.stringify(f)});engine.once('ready',()=>process.stdout.write(JSON.stringify({pid:engine.pid})+'\\n'));engine.once('failure',()=>engine.stop());engine.launch();`;
      parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
      const [bytes] = await once(parent.stdout, "data");
      pid = JSON.parse(bytes).pid;
      parent.kill("SIGKILL");
      await once(parent, "exit");
      let alive = true;
      for (let i = 0; i < 200 && alive; i++) {
        try {
          process.kill(pid, 0);
          await wait(25);
        } catch {
          alive = false;
        }
      }
      assert.equal(alive, false, "engine must exit from private connected socket EOF");
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
