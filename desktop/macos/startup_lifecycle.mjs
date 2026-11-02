#!/usr/bin/env node
// Exercise the ordinary, uninstrumented relocated app. Every observed process
// must belong to this unique bundle before the fixture uses its port or signals it.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ScriptedProvider } from "../../crates/nac-server/web/e2e/scripted-provider.ts";
import { exerciseOwnedWorker } from "./owned_worker_fixture.mjs";

const execute = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await wait(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function processes() {
  const {stdout} = await execute("/bin/ps", ["-ww", "-axo", "pid=,ppid=,stat=,command="]);
  return stdout.split("\n").flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match ? [{pid:Number(match[1]), parent:Number(match[2]), state:match[3], command:match[4]}] : [];
  });
}
const isLive = record => record && !record.state.startsWith("Z");
async function namesExecutable(command, executable) {
  const marker = executable.endsWith("NACPreview") ? "/Contents/MacOS/NACPreview" : "/Contents/Resources/nac-web";
  const offset = command.indexOf(marker);
  if (offset < 0) return false;
  const end = offset + marker.length;
  if (command.length !== end && command[end] !== " ") return false;
  // Foundation Process may spell Darwin's physical /private/var path as /var.
  // Bind to filesystem identity, retaining the exact parent and unique bundle.
  return await fs.realpath(command.slice(0, end)).catch(() => null) === executable;
}
async function ownedRows(...executables) {
  const rows = await processes();
  const matches = await Promise.all(rows.map(async row => {
    for (const executable of executables) {
      if (await namesExecutable(row.command, executable)) return {...row, executable};
    }
    return null;
  }));
  return matches.filter(Boolean);
}
async function ownedSignal(pid, executable, signal) {
  const record = (await processes()).find(row => row.pid === pid);
  if (!isLive(record)) return;
  assert(await namesExecutable(record.command, executable),
    "Refusing to signal a replaced process");
  process.kill(pid, signal);
}

async function runCase(source, destination, scenario) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nac-normal-lifecycle-")));
  const app = path.join(root, "Moved ordinary app with spaces", "NAC.app");
  const native = path.join(app, "Contents/MacOS/NACPreview");
  const executable = path.join(app, "Contents/Resources/nac-web");
  const home = path.join(root, "home with spaces");
  const nac = path.join(home, "selected nac");
  const workspace = path.join(root, "workspace with spaces");
  const provider = new ScriptedProvider();
  const evidence = {scenario, status:"failed", actual_appkit:true, ordinary_app:true,
    fixture:"dummy credentials and provider", visible_paint:"not_qualified"};
  let appPID, childPID, opened, lock, lockExit;
  let cleanupSafe = false;
  try {
    await fs.cp(source, app, {recursive:true});
    evidence.build_receipt = JSON.parse(await fs.readFile(path.join(app, "Contents/Resources/build-receipt.json"), "utf8"));
    assert(evidence.build_receipt.normal_startup && !evidence.build_receipt.smoke_instrumentation);
    assert(evidence.build_receipt.preview_definitions_excluded);
    const identity = evidence.build_receipt.engine_identity;
    const store = path.join(nac, {dev:"dev.db", beta:"beta.db", stable:"stable.db"}[identity.track]);
    await fs.mkdir(nac, {recursive:true, mode:0o700});
    await fs.mkdir(workspace, {mode:0o700});
    const environment = {HOME:home, NAC_HOME:nac, PATH:"/usr/bin:/bin:/usr/sbin:/sbin",
      LANG:"en_US.UTF-8", NAC_ORCHESTRATION:"1", NAC_TELEMETRY:"disabled", BROWSER:"none",
      GIT_CONFIG_NOSYSTEM:"1", GIT_CONFIG_GLOBAL:"/dev/null"};
    await execute("/usr/bin/git", ["-C", workspace, "init", "--quiet", "--initial-branch=main"], {env:environment});
    await execute("/usr/bin/git", ["-C", workspace, "-c", "user.name=Native lifecycle fixture",
      "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit",
      "--quiet", "--allow-empty", "-m", "fixture baseline"], {env:environment});
    await provider.start();
    environment.MODELS_DEV_URL = provider.baseUrl + "/models-dev";
    if (scenario === "preflight-parent-loss") {
      // Hold the existing Rust publication lock throughout parent/helper exit.
      const python = (await execute("/usr/bin/which", ["python3"])).stdout.trim();
      lock = spawn(python, ["-u", "-c", "import fcntl,os,sys; f=open(sys.argv[1],'a+'); os.fchmod(f.fileno(),0o600); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); sys.stdin.read()",
        path.join(nac, "config.toml.lock")], {stdio:["pipe","pipe","pipe"]});
      lockExit = once(lock, "exit");
      await until("owned configuration lock", async () => lock.stdout.read()?.toString().includes("locked"));
    }
    opened = spawn("/usr/bin/open", ["-n", "-W", "-a", app, "--args", "--directory", home],
      {cwd:"/", env:environment, stdio:"ignore"});
    const application = await until("exact relocated application", async () =>
      (await ownedRows(native)).find(isLive));
    appPID = application.pid;
    evidence.app = application;
    const observed = new Map();
    const child = await until("owned bundled engine", async () => {
      const rows = await ownedRows(executable);
      for (const row of rows) {
        observed.set(row.pid, row);
      }
      evidence.observed_children = [...observed.values()];
      return rows.find(row => row.parent === appPID &&
        row.command.includes(scenario === "preflight-parent-loss" ? "__desktop-configuration" : "--bind 127.0.0.1:0"));
    });
    childPID = child.pid;
    evidence.child = child;
    evidence.selected_store = store;
    if (scenario === "owned-worker") {
      // Observe only this verified engine's listener, never a fixed/default port.
      const base = await until("owned engine loopback listener", async () => {
        try {
          const {stdout} = await execute("/usr/sbin/lsof", ["-nP", "-a", "-p", String(childPID), "-iTCP", "-sTCP:LISTEN", "-Fn"]);
          const port = stdout.match(/^n127\.0\.0\.1:(\d+)$/m)?.[1];
          return port && `http://127.0.0.1:${port}`;
        } catch { return null; }
      });
      const policy = await until("shared workspace policy", async () => {
        try {
          const response = await fetch(base + "/ui-config", {signal:AbortSignal.timeout(1000)});
          return response.ok && response.json();
        } catch { return null; }
      });
      assert.equal(policy.orchestration_enabled, true);
      evidence.ui_policy = policy;
      Object.assign(evidence, await exerciseOwnedWorker({provider, base, workspace, store, executable, enginePID:childPID}));
    }
    const stoppedAt = Date.now();
    await ownedSignal(appPID, native, "SIGTERM");
    await until("application parent exit", async () => !isLive((await processes()).find(row => row.pid === appPID)), 5000);
    await until("bundled child exit after parent loss", async () => !isLive((await processes()).find(row => row.pid === childPID)),
      scenario === "preflight-parent-loss" ? 13000 : 25000);
    evidence.parent_loss_cleanup_ms = Date.now() - stoppedAt;
    if (scenario === "preflight-parent-loss") {
      assert.equal(await fs.stat(store).catch(() => null), null, "Preflight parent loss created a database");
      evidence.publication_lock_held_until_helper_exit = true;
      evidence.no_database_opened = true;
    }
    evidence.status = "passed";
  } finally {
    for (const [pid, executablePath] of [[appPID, native], [childPID, executable]]) {
      if (pid) await ownedSignal(pid, executablePath, "SIGTERM");
    }
    try {
      await until("owned bundle descendant cleanup", async () => !(await ownedRows(native, executable)).some(isLive), 26000);
      cleanupSafe = true;
    } finally {
      if (lock) { lock.stdin.end(); await lockExit; }
      await provider.stop();
      if (opened && opened.exitCode === null) opened.kill("SIGTERM");
      if (cleanupSafe) {
        await fs.rm(root, {recursive:true, force:true});
        evidence.cleaned = true;
      } else { evidence.retained_profile = root; }
      await fs.mkdir(destination, {recursive:true});
      await fs.writeFile(path.join(destination, scenario + ".json"), JSON.stringify(evidence, null, 2) + "\n");
    }
  }
}

const source = await fs.realpath(process.argv[2]);
const destination = path.resolve(process.argv[3]);
const scenarios = process.env.NAC_STARTUP_LIFECYCLE_CASES?.split(",") ?? ["owned-worker", "preflight-parent-loss"];
assert(scenarios.length && scenarios.every(value => ["owned-worker", "preflight-parent-loss"].includes(value)));
for (const scenario of scenarios) await runCase(source, destination, scenario);
