// Shared direct parent/child fixture; credentials use the ordinary Rust owner.
import assert from "node:assert/strict";
import { ScriptGate } from "../../crates/nac-server/web/e2e/scripted-provider.ts";
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer=setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
  })]); } finally { clearTimeout(timer); }
}
export async function exerciseOwnedDirect({provider, base, workspace, enginePID}) {
  const childGate = new ScriptGate();
  const evidence = {};
  try {
    provider.enqueue("parent-dispatch", { token: "FINDER_HELPER_PARENT", requiredTools: ["subagent"] }, {
      kind: "function_call", name: "subagent", callId: "finder-helper-dispatch",
      arguments: { profile: "general", description: "Finder helper child",
        prompt: "FINDER_HELPER_CHILD inspect the owned fixture", child_session_id: null, background: false },
    });
    provider.enqueue("child", { token: "FINDER_HELPER_CHILD", forbiddenTools: ["subagent"] },
      { kind: "text", text: "owned direct child completed" }, childGate);
    provider.enqueue("parent-completion", { functionOutputCallId: "finder-helper-dispatch" },
      { kind: "text", text: "owned child completion observed" });
    async function request(route, body, method = "POST") {
      const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
      assert(response.ok, `${route}: HTTP ${response.status}`);
      return response.status === 204 ? null : response.json();
    }
    await request("/credentials/FINDER_HELPER_KEY", { value: "nac-finder-dummy-only" }, "PUT");
    const session = await request("/sessions", { behavior: "direct", cwd: workspace,
      backend: "openai-responses", model: "gpt-5.6-sol", base_url: provider.baseUrl,
      api_key_env: "FINDER_HELPER_KEY", extra_headers: {}, compaction_threshold: 0 });
    const id = session.metadata.session_id;
    await request(`/sessions/${id}/runs`, { prompt: "FINDER_HELPER_PARENT" });
    await bounded(childGate.accepted, 15000, "bundled direct child provider request");
    const children = await request(`/sessions/${id}/children`, null, "GET");
    const matches = children.filter(child => child.description === "Finder helper child");
    assert.equal(matches.length, 1, "Exactly one direct child must belong to the parent");
    assert(matches[0].child_session_id, "The child must have a durable session identity");
    evidence.child_session_id = matches[0].child_session_id;
    evidence.engine_pid = enginePID;
    childGate.release();
    await provider.waitForRequestCount(3);
    for (let attempt = 0; attempt < 300; attempt++) {
      const snapshot = await request(`/sessions/${id}`, null, "GET");
      if (snapshot.active_run == null) break;
      assert(attempt < 299, "Owned direct fixture run failed to settle");
      await wait(50);
    }
    provider.assertConsumed();
    assert(provider.requests.every((record) => record.headers.authorization === "Bearer nac-finder-dummy-only"));
    evidence.stored_credential_owner_consumed = true;
    evidence.status = "passed";
    return evidence;
  } finally { childGate.release(); }
}
