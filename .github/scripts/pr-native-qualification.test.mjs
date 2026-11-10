import {reverseNativeQualification, reverseNativeApp, nativeOrdinary} from './native-qualification-wiring.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
import { requiredJobs, managedCallerJobs, requireComplete } from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const read = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const target = "all-347-paths-macos26";
const sha = "a".repeat(40);
const ordinary = Object.keys(read("stable-release").jobs).filter(id =>
  !["ci-admission", "native-qualification", "native-admission", "native-exact"].includes(id));
const context = (event = "workflow_dispatch", ref = "refs/heads/codex/native-unit", choice = target) => ({
  github: { event_name: event, ref, sha, run_attempt: "1" },
  needs: { prepare: { result: "success", outputs: { admission_mode: "full" } } },
  inputs: { "native-qualification": choice, "native-paths-custody": "synthetic" },
});

// Evaluate these workflows' actual simple boolean expressions. This is a
// focused scheduling model, not a GitHub runner or a replacement for actionlint.
// Strings/equality/boolean operators here have the same truth values in both.
function condition(job, ctx, needs = {}) {
  const expression = (job.if ?? "true").replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.([\w-]+)/g, (_, name) => `needs[${JSON.stringify(name)}]`);
  const results = Object.values(needs).map(n => n.result);
  const success = () => results.every(r => r === "success");
  if (!/\b(always|success|failure|cancelled)\(/.test(expression) && !success()) return false;
  return Boolean(vm.runInNewContext(expression, { ...ctx, needs, always: () => true, success,
    failure: () => results.includes("failure"), cancelled: () => false,
    startsWith: (value, prefix) => value.startsWith(prefix) }, { timeout: 100 }));
}

function selection(workflow, ctx, overrides = {}) {
  const pending = new Set(Object.keys(workflow.jobs)), results = {};
  while (pending.size) {
    const before = pending.size;
    for (const id of pending) {
      const job = workflow.jobs[id];
      const dependencies = typeof job.needs === "string" ? [job.needs] : job.needs ?? [];
      if (!dependencies.every(n => results[n])) continue;
      const needs = Object.fromEntries(dependencies.map(n => [n, results[n]]));
      const runs = condition(job, ctx, needs);
      results[id] = { result: runs ? overrides[id] ?? "success" : "skipped", outputs:
        id === "prepare" && runs ? { run: "true", sha, managed_applicable: "true" } : {} };
      pending.delete(id);
    }
    assert.ok(pending.size < before, "job graph must have no missing or cyclic dependencies");
  }
  return Object.fromEntries(Object.entries(results).map(([id, value]) => [id, value.result]));
}

function aggregateName(workflow, ctx) {
  const value = workflow.jobs["required-pr-checks"].name;
  return value.startsWith("${{") ? vm.runInNewContext(value.slice(3, -2), ctx, { timeout: 100 }) : value;
}

test("native-only skipped aggregate cannot mint the required PR check context", () => {
  const stable = read("stable-release");
  assert.notEqual(aggregateName(stable, context()), "Required PR checks",
    "GitHub accepts a skipped required check; native-only must use a distinct context");
});

test("native-only aggregate refuses missing needs even with always status semantics", () => {
  const stable = read("stable-release");
  const needs = Object.fromEntries(stable.jobs["required-pr-checks"].needs.map(id =>
    [id, { result: "skipped", outputs: {} }]));
  assert.equal(condition(stable.jobs["required-pr-checks"], context(), needs), false,
    "skipping prepare alone leaves the old always() aggregate running with missing needs");
});

test("native-only selection skips every ordinary job transitively and failed admission never schedules Mac", () => {
  const stable = read("stable-release");
  const selected = selection(stable, context());
  for (const id of ordinary) assert.equal(selected[id], "skipped", id);
  assert.equal(selected["native-admission"], "success");
  assert.equal(selected["native-exact"], "success");
  const rejected = selection(stable, context(), { "native-admission": "failure" });
  assert.equal(rejected["native-exact"], "skipped");
  for (const id of ordinary) assert.equal(rejected[id], "skipped", id);
});

test("ordinary PR push tag and default dispatch keep the complete existing graph and Required PR checks", () => {
  const stable = read("stable-release");
  const events = [["pull_request", "refs/pull/42/merge", ""], ["push", "refs/heads/dev", ""],
    ["push", "refs/heads/main", ""], ["push", "refs/tags/v1.2.3", ""],
    ["workflow_dispatch", "refs/heads/dev", ""], ["workflow_dispatch", "refs/heads/dev", "none"],
    ["pull_request", "refs/pull/42/merge", target], ["push", "refs/tags/v1.2.3", target]];
  for (const [event, ref, choice] of events) {
    const selected = selection(stable, context(event, ref, choice));
    for (const id of ordinary) assert.equal(selected[id],
      id === "publish" && !(event === "push" && ref.startsWith("refs/tags/v")) ? "skipped" : "success", `${event}/${ref}/${id}`);
    assert.equal(selected["native-admission"], "skipped");
    assert.equal(selected["native-exact"], "skipped");
    assert.equal(aggregateName(stable, context(event, ref, choice)), "Required PR checks");
  }
  const failed = selection(stable, context("pull_request", "refs/pull/42/merge", ""), { lint: "failure" });
  assert.equal(failed["required-pr-checks"], "success", "ordinary aggregate must still run after failure");
  assert.deepEqual(stable.jobs["required-pr-checks"].needs.sort(), [...requiredJobs, ...managedCallerJobs].sort());
  const emptyNeeds = Object.fromEntries(requiredJobs.map(id => [id, { result: "skipped" }]));
  assert.throws(() => requireComplete(emptyNeeds, "true", sha), "native-only dispatch is never substitute PR CI");
});

test("ordinary workflow semantics permissions steps contexts and release gates remain exact", () => {
  const stable = read("stable-release");
  reverseNativeQualification(stable);
  assert.equal(createHash("sha256").update(JSON.stringify(stable)).digest("hex"),
    "93711739910ed3f5b024b351fc18ce58cd54d5051c400c10b62e18e29f883879",
    "reversing only the reviewed route and path-test step recovers current dev exactly");
});

test("native call binds this exact reviewed dispatch commit and keeps read-only bounded reusable jobs", () => {
  const stable = read("stable-release"), reuse = read("macos-qualification");
  assert.deepEqual(stable.on.workflow_dispatch.inputs["native-qualification"].options, ["none", target]);
  assert.equal(stable.on.workflow_dispatch.inputs["native-qualification"].default, "none");
  assert.equal(stable.permissions.contents, "read");
  const call = stable.jobs["native-exact"];
  assert.equal(call.needs, "native-admission");
  assert.equal(call.uses, "./.github/workflows/macos-qualification.yml");
  assert.equal(call.with["harness-sha"], "${{ github.sha }}");
  assert.equal(call.with["paths-custody"], "${{ inputs['native-paths-custody'] }}");
  assert.equal(call.secrets, undefined);
  assert.equal(call.permissions, undefined);
  assert.equal(reuse.jobs.resolve["timeout-minutes"], 5);
  assert.equal(reuse.jobs.native["timeout-minutes"], 40);
  assert.equal(stable.jobs["native-admission"]["timeout-minutes"], 5);
});

test("actual admission Python rejects wrong ref retry absent or foreign custody before any Mac job", () => {
  const step = read("stable-release").jobs["native-admission"].steps.find(s => s.id === "admit");
  assert.equal(step["working-directory"], "desktop/macos");
  const match = step.run.match(/^python3 -B - <<'PY'\n([\s\S]*)\nPY\s*$/);
  assert.ok(match, "test executes the exact admission body with synthetic environment only");
  const product = readFileSync("desktop/macos/ci_paths_protocol.py", "utf8").match(/PRODUCT = '([a-f0-9]{40})'/)[1];
  const now = Date.now() / 1000;
  const capsule = { version: 1, H: sha, T: product, cases: ["paths-xctest", "paths-failure-xctest"],
    source_preflight: true, native_eligibility: true, allocation_id: "synthetic-source-control-only",
    started_at_epoch: now - 1, deadline_epoch: now + 1000, retry_budget: 0 };
  const env = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1", GITHUB_SHA: sha,
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/codex/native-unit", GITHUB_RUN_ATTEMPT: "1",
    HARNESS_SHA: sha, QUALIFICATION: target, NAC_PATHS_CUSTODY_JSON: JSON.stringify(capsule) };
  const run = extra => spawnSync("python3", ["-B", "-c", match[1]],
    { cwd: "desktop/macos", env: { ...env, ...extra }, encoding: "utf8", timeout: 5000 });
  assert.equal(run({}).status, 0);
  for (const change of [{ GITHUB_REF: "refs/heads/dev" }, { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_EVENT_NAME: "pull_request" }, { NAC_PATHS_CUSTODY_JSON: "" },
    { NAC_PATHS_CUSTODY_JSON: " ".repeat(8193) },
    { NAC_PATHS_CUSTODY_JSON: "{}" }, { HARNESS_SHA: "b".repeat(40) }, { QUALIFICATION: "foreign" },
    { NAC_PATHS_CUSTODY_JSON: JSON.stringify({ ...capsule, native_eligibility: false }) },
    { NAC_PATHS_CUSTODY_JSON: JSON.stringify({ ...capsule, deadline_epoch: now - 1 }) }]) {
    assert.notEqual(run(change).status, 0, JSON.stringify(Object.keys(change)));
  }
});


test("ordinary preservation rejects changes to admission, caches, source security and supplier inputs", () => {
  const mutations = [
    w => { w.jobs.prepare.if = '${{ always() }}'; },
    w => { w.jobs['required-pr-checks'].name = 'Required PR checks'; },
    w => { w.jobs['native-exact'].needs = []; },
    w => { w.jobs['native-admission']['timeout-minutes'] = 40; },
    w => { w.on.workflow_dispatch.inputs['native-qualification'].options.push('foreign'); },
    w => { w.jobs['source-security'].permissions = {contents:'write'}; },
    w => { w.jobs['browser-binary'].steps.find(s => s.uses?.startsWith('Swatinem/')).with['save-if'] = 'true'; },
    w => { delete w.jobs['ci-admission']; },
  ];
  for (const change of mutations) {
    const w = read('stable-release'); change(w);
    assert.throws(() => {
      reverseNativeQualification(w);
      assert.equal(createHash('sha256').update(JSON.stringify(w)).digest('hex'),
        '93711739910ed3f5b024b351fc18ce58cd54d5051c400c10b62e18e29f883879');
    });
  }
});

test("legacy supplier selections retain ordinary CI and the existing reusable interface", () => {
  const stable = read('stable-release');
  assert.deepEqual(stable.on.workflow_dispatch.inputs.native_qualification.options,
    ['none','all-341-macos26','all-343-macos26','all-351-macos14','all-352-macos26',
      'all-342-startup-macos26','all-344-lifecycle-macos26','all-347-paths-macos26']);
  for (const legacy of stable.on.workflow_dispatch.inputs.native_qualification.options.slice(1)) {
    const ctx = context(); ctx.inputs['native-qualification'] = 'none'; ctx.inputs.native_qualification = legacy;
    const selected = selection(stable, ctx);
    for (const id of ordinary) assert.equal(selected[id], id === 'publish' ? 'skipped' : 'success', legacy + '/' + id);
    assert.equal(selected['native-qualification'], 'success');
    assert.equal(selected['native-exact'], 'skipped');
  }
  assert.equal(selection(stable, context())['native-qualification'], 'skipped');
});

test("new ordinary app lane retains the current explicit cold-cache and source-bound execution contracts", () => {
  const native = read('macos-native'), app = native.jobs.app;
  assert.equal(app['runs-on'], 'macos-26'); assert.equal(app['timeout-minutes'], 40);
  assert.equal(app.env.DEVELOPER_DIR, '/Applications/Xcode_26.6.app/Contents/Developer');
  const cache = app.steps.find(s => s.uses?.startsWith('Swatinem/'));
  assert.equal(cache.with['prefix-key'], native.jobs.native.steps.find(s => s.uses?.startsWith('Swatinem/')).with['prefix-key']);
  assert.equal(app.steps[0].with.ref, '${{ inputs.source-sha }}');
  assert.ok(app.steps.some(s => s.run?.includes('desktop/macos/ci.py --expected-sha')));
  reverseNativeApp(native);
  assert.deepEqual(Object.keys(native.jobs), ['native']);
});

test("startup catalog binds exact P12 and interaction ten-file Q supplier", () => {
  const startup = JSON.parse(readFileSync("desktop/macos/ci-qualifications.json", "utf8"))["all-342-startup-macos26"];
  assert.equal(startup.source_sha, "4b7a1f3e0bf6175a77c5ebf627fe965860e99976");
  assert.equal(startup.test_source_sha, "8397bafe8fb5f439b702ebf3e941eed802ce71aa");
  assert.deepEqual(startup.test_files, {
  "README.md": "78555438488b65c400415e924d5e95854b4569d455263f3edb948362dbe276d0",
  "StartupJourneys.swift": "e516e4352f68e18a0a2ee9ae14742722d035e8a6668d5e87b0d7cdc41babec68",
  "contract.py": "d159672bb8eda5d3bf4e5d462813452c83a673974749ed4f7f07b3bb9341b91b",
  "test_contract.py": "c33ac0f526d8213758970c2f671ab71b08afa2fc4fd9287f9e56942012735f5e",
  "StartupAXGuard.swift": "266e73c6362b12f6df51ef3f4d349b3d22b71a1eab5139e71e2336b1d4c3778d",
  "StartupAXReceipt.swift": "00a8be55d2fab69a7f0e58f2b747067c5ed3ee31e0c43d8c4d02753307a1a681",
  "AX-WITNESS-CONTRACT.md": "22e3f67028d273d74b2ee792b372674cdd58ae3145f472d47a979f3f1d588aeb",
  "test_ax_witness.py": "512c033b7f6a8c5f38fac6a03f0c48a4576c0482d4b8d864d04ab81883c08750",
  "AGENTS.md": "8d9df6ef5e38f1f826be1681b127c9851caead040f1a8774ef9db12135da1431",
  "test_title_assertion.py": "e4389c84259f0f8dbbd3b42eef153757b8f9da26d337010b8affd1719f415cef"
});
  assert.equal(startup.protocol_source_sha, "7325c48b3c9ec7036e255a6bd92f31c1a98c1607");
  assert.deepEqual(startup.scenarios, ["onboarding", "configuredLocal", "invalidConfig", "futureStore"]);
});
