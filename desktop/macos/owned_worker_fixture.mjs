// Shared owned-worker fixture; dummy credentials only, ordinary Rust HTTP owners.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ScriptGate } from "../../crates/nac-server/web/e2e/scripted-provider.ts";
const execute = promisify(execFile);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer=setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}
export async function exerciseOwnedWorker({provider, base, workspace, store, executable, enginePID}) {
  const workerGate = new ScriptGate();
  const evidence = {};
  try {
    provider.enqueue("parent-dispatch", { token: "FINDER_HELPER_PARENT", requiredTools: ["thread"] }, {
      kind: "function_call", name: "thread", callId: "finder-helper-dispatch",
      arguments: { name: "finder-helper", action: "FINDER_HELPER_WORKER inspect the owned fixture" },
    });
    provider.enqueue("worker", { token: "FINDER_HELPER_WORKER", requiredTools: ["read"] },
      { kind: "text", text: "owned bundled worker completed" }, workerGate);
    provider.enqueue("parent-completion", { functionOutputCallId: "finder-helper-dispatch" },
      { kind: "text", text: "owned worker dispatch observed" });
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
    assert.equal(workers[0].parent, enginePID, "Worker must be an owned engine descendant");
    assert(workers[0].command.includes(store), "Worker must retain the selected disposable store");
    evidence.worker = workers[0];
    evidence.engine_pid = enginePID;
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
    return evidence;
  } finally { workerGate.release(); }
}
