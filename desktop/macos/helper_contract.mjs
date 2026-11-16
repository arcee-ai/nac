#!/usr/bin/env node
// Owned worker characterization, using the shared scripted provider. This is
// CLI/process evidence; it does not substitute for AppKit/WKWebView acceptance.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ScriptedProvider } from "../../crates/nac-server/web/e2e/scripted-provider.ts";

import { exerciseOwnedWorker } from "./owned_worker_fixture.mjs";

const execute = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

export async function runHelperContract(executable, destination) {
  executable = await fs.realpath(executable);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-finder-worker-"));
  const workspace = path.join(root, "workspace with spaces");
  const home = path.join(root, "home");
  const nac = path.join(home, "selected nac");
  const store = path.join(root, "selected store.db");
  const provider = new ScriptedProvider();
  let server;
  let exited;
  let serverExit;
  let safeToRemove = true;
  const evidence = { executable, fixture: "dummy scripted provider", actual_appkit: false, status: "failed" };
  try {
    const identity = await execute(executable, ["__desktop-identity"]);
    evidence.engine_identity = JSON.parse(identity.stdout);
    const digest = await execute("/usr/bin/shasum", ["-a", "256", executable]);
    evidence.engine_sha256 = digest.stdout.slice(0, 64);
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(nac, { recursive: true });
    const environment = { HOME: home, NAC_HOME: nac, PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      NAC_ORCHESTRATION: "1", NAC_TELEMETRY: "disabled", BROWSER: "none",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const git = (...args) => execute("/usr/bin/git", ["-C", workspace, ...args], { env: environment });
    await git("init", "--quiet", "--initial-branch=main");
    await git("-c", "user.name=Disposable Finder fixture", "-c", "user.email=fixture@example.test",
      "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture baseline");
    await provider.start();
    environment.MODELS_DEV_URL = provider.baseUrl + "/models-dev";
    server = spawn(executable, ["--bind", "127.0.0.1:0", "--directory", workspace,
      "--store-path", store, "--worker-executable", executable, "--no-open"], {
      cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"],
    });
    exited = once(server, "exit").then((result) => { serverExit = result; return result; });
    let diagnostic = "";
    let ready;
    const listening = new Promise((resolve, reject) => {
      ready = resolve;
      server.once("error", reject);
      exited.then(() => reject(new Error("Owned fixture engine exited before readiness")));
    });
    for (const output of [server.stdout, server.stderr]) output.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-16384);
      const endpoint = diagnostic.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (endpoint) ready(endpoint);
    });
    const base = await bounded(listening, 15000, "owned fixture readiness");
    Object.assign(evidence, await exerciseOwnedWorker({provider, base, workspace, store,
      executable, enginePID: server.pid}));
  } finally {
    let cleanupError;
    if (server && !serverExit) {
      server.kill("SIGTERM");
      try { await bounded(exited, 25000, "owned engine shutdown"); }
      catch (error) { safeToRemove = false; cleanupError = error; }
    }
    await provider.stop();
    const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "command="]);
    if (stdout.split("\n").some((line) => line.trimStart().startsWith(executable + " __worker ") && line.includes(store))) {
      safeToRemove = false;
      cleanupError = new Error("Owned worker remained after engine shutdown; fixture profile retained");
    }
    if (safeToRemove) {
      await fs.rm(root, { recursive: true, force: true });
      evidence.cleaned = true;
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify(evidence, null, 2) + "\n");
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runHelperContract(process.argv[2], process.argv[3]);
}
