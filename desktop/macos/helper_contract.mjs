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
import { ScriptGate, ScriptedProvider } from "../../crates/nac-server/web/e2e/scripted-provider.ts";

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
  const workerGate = new ScriptGate();
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
    provider.enqueue("parent-dispatch", { token: "FINDER_HELPER_PARENT", requiredTools: ["thread"] }, {
      kind: "function_call", name: "thread", callId: "finder-helper-dispatch",
      arguments: { name: "finder-helper", action: "FINDER_HELPER_WORKER inspect the owned fixture" },
    });
    provider.enqueue("worker", { token: "FINDER_HELPER_WORKER", requiredTools: ["read"] },
      { kind: "text", text: "owned bundled worker completed" }, workerGate);
    provider.enqueue("parent-completion", { functionOutputCallId: "finder-helper-dispatch" },
      { kind: "text", text: "owned worker dispatch observed" });
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
    async function request(route, body, method = "POST") {
      const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
      assert(response.ok, `${route}: HTTP ${response.status}`);
      return response.status === 204 ? null : response.json();
    }
    // Store the fixture key through the existing hardened owner, then require
    // both parent and worker to consume it without an environment key copy.
    await request("/credentials/FINDER_HELPER_KEY", { value: "nac-finder-dummy-only" }, "PUT");
    const session = await request("/sessions", { behavior: "orchestrator", cwd: workspace,
      backend: "openai-responses", model: "gpt-5.6-sol", base_url: provider.baseUrl,
      api_key_env: "FINDER_HELPER_KEY", extra_headers: {}, orchestrator_compaction_threshold: 0 });
    const id = session.metadata.session_id;
    await request(`/sessions/${id}/runs`, { prompt: "FINDER_HELPER_PARENT" });
    await bounded(workerGate.accepted, 15000, "bundled worker provider request");
    const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "pid=,ppid=,command="]);
    const workers = stdout.split("\n").flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      return match && match[3].startsWith(executable + " __worker ") &&
        match[3].includes(`--session-id ${id} `) ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : [];
    });
    assert.equal(workers.length, 1, "Exactly one worker must execute the specified bundled entry point");
    assert.equal(workers[0].parent, server.pid, "Worker must be an owned engine descendant");
    assert(workers[0].command.includes(store), "Worker must retain the selected disposable store");
    evidence.worker = workers[0];
    evidence.engine_pid = server.pid;
    workerGate.release();
    await provider.waitForRequestCount(3);
    for (let attempt = 0; attempt < 300; attempt++) {
      const snapshot = await request(`/sessions/${id}`, null, "GET");
      if (snapshot.active_run == null) break;
      assert(attempt < 299, "Owned fixture run failed to settle");
      await wait(50);
    }
    provider.assertConsumed();
    assert(provider.requests.every((record) => record.headers.authorization === "Bearer nac-finder-dummy-only"));
    evidence.stored_credential_owner_consumed = true;
    evidence.status = "passed";
  } finally {
    workerGate.release();
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
