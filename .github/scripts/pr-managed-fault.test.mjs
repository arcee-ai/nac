import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { qualityJobs, qualityReceipt, qualityMode, managedCallerJobs } from "./pr-checks.mjs";
import { faultReceipt, verifyFaultReceipt, faultMode } from "./managed-fault.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const sha = "a".repeat(40);
const context = { repository: "arcee-ai/nac", run_id: "123", run_attempt: "1" };
const receipt = () => faultReceipt(sha, "success", sha, context);
const env = { ...process.env, EXPECTED_SHA: sha, CHECKOUT_SHA: sha, FIXTURE_RESULT: "success", GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: context.run_id, GITHUB_RUN_ATTEMPT: context.run_attempt };
const cli = (command, overrides = {}) => spawnSync(process.execPath, [".github/scripts/managed-fault.mjs", command], { env: { ...env, ...overrides }, encoding: "utf8" });

test("fault receipt requires the exact checkout, complete fixture and valid run identity", () => {
  assert.deepEqual(receipt(), { schema_version: 1, sha, ...context, fixture_result: "success" });
  verifyFaultReceipt(receipt(), sha, context);
  for (const result of ["failure", "cancelled", "skipped", "pending", "", undefined, true]) {
    assert.throws(() => faultReceipt(sha, result, sha, context));
  }
  for (const checkout of ["b".repeat(40), "", undefined]) assert.throws(() => faultReceipt(checkout, "success", sha, context));
  for (const candidate of ["", undefined, "A".repeat(40), "a".repeat(39), 123, {}]) {
    assert.throws(() => faultReceipt(candidate, "success", candidate, context));
  }
  for (const [field, values] of Object.entries({ repository: ["", "nac", "other/repo/extra", null], run_id: ["0", "01", 123, "", "1.5"], run_attempt: ["0", "01", 1, "", "1.5"] })) {
    for (const value of values) assert.throws(() => faultReceipt(sha, "success", sha, { ...context, [field]: value }));
  }
});

test("fault evidence rejects every missing, extra, malformed, unsuccessful or foreign field", () => {
  for (const value of [null, undefined, [], true, "receipt", {}, { ...receipt(), extra: true }, { ...receipt(), schema_version: "1" }, { ...receipt(), schema_version: 2 }]) {
    assert.throws(() => verifyFaultReceipt(value, sha, context));
  }
  for (const field of Object.keys(receipt())) {
    const missing = receipt();
    delete missing[field];
    assert.throws(() => verifyFaultReceipt(missing, sha, context), undefined, field);
  }
  for (const [field, value] of [["sha", "b".repeat(40)], ["repository", "foreign/nac"], ["run_id", "124"], ["run_attempt", "2"]]) {
    assert.throws(() => verifyFaultReceipt({ ...receipt(), [field]: value }, sha, context));
  }
  for (const result of ["failure", "cancelled", "skipped", "pending", undefined]) {
    assert.throws(() => verifyFaultReceipt({ ...receipt(), fixture_result: result }, sha, context));
  }
});

test("only blank or fully valid earlier fault evidence selects full current-attempt execution", () => {
  assert.equal(faultMode(undefined, sha, context), "full");
  assert.equal(faultMode(receipt(), sha, context), "reuse");
  const current = { ...context, run_attempt: "2" };
  assert.equal(faultMode(receipt(), sha, current), "full");
  assert.throws(() => verifyFaultReceipt(receipt(), sha, current));
  for (const corrupt of [null, {}, { ...receipt(), schema_version: 0 }, { ...receipt(), extra: true }, { ...receipt(), fixture_result: "failure" }, { ...receipt(), sha: "b".repeat(40) }, { ...receipt(), run_id: "124" }, { ...receipt(), repository: "foreign/nac" }, { ...receipt(), run_attempt: "3" }, { ...receipt(), run_attempt: 1 }]) {
    assert.throws(() => faultMode(corrupt, sha, current));
  }
  assert.throws(() => faultMode(undefined, sha, { ...current, run_attempt: "0" }));
  const huge = "9007199254740993";
  const large = faultReceipt(sha, "success", sha, { ...context, run_attempt: huge });
  assert.equal(faultMode(large, sha, { ...context, run_attempt: huge }), "reuse");
  assert.throws(() => faultMode(large, sha, { ...context, run_attempt: "9007199254740992" }));
});

test("real fault CLI fails closed and never interprets nonblank corrupt input as full fallback", () => {
  const created = cli("receipt");
  assert.equal(created.status, 0, created.stderr);
  const raw = created.stdout.trim().slice("fault_receipt=".length);
  assert.deepEqual(JSON.parse(raw), receipt());
  assert.equal(cli("verify", { FAULT_RECEIPT: raw }).status, 0);
  assert.equal(cli("mode", { FAULT_RECEIPT: raw }).stdout.trim(), "mode=reuse");
  assert.equal(cli("mode", { FAULT_RECEIPT: "" }).stdout.trim(), "mode=full");
  assert.equal(cli("mode", { FAULT_RECEIPT: raw, GITHUB_RUN_ATTEMPT: "2" }).stdout.trim(), "mode=full");
  for (const rawValue of ["null", "false", "[]", "{}", " ", "not-json", JSON.stringify({ ...receipt(), fixture_result: "failure" }), JSON.stringify({ ...receipt(), run_attempt: "3" })]) {
    const result = cli("mode", { FAULT_RECEIPT: rawValue, GITHUB_RUN_ATTEMPT: "2" });
    assert.notEqual(result.status, 0, rawValue);
    assert.equal(result.stdout, "", rawValue);
  }
  for (const overrides of [{ EXPECTED_SHA: "b".repeat(40) }, { GITHUB_RUN_ID: "124" }, { GITHUB_REPOSITORY: "foreign/nac" }, { GITHUB_RUN_ATTEMPT: "2" }]) {
    assert.notEqual(cli("verify", { FAULT_RECEIPT: raw, ...overrides }).status, 0);
  }
  for (const overrides of [{ CHECKOUT_SHA: "b".repeat(40) }, { FIXTURE_RESULT: "failure" }, { FIXTURE_RESULT: "skipped" }, { FIXTURE_RESULT: "" }, { GITHUB_RUN_ID: "" }]) {
    const result = cli("receipt", overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  }
  assert.notEqual(cli("mode", { FAULT_RECEIPT: "", EXPECTED_SHA: "" }).status, 0);
  assert.notEqual(cli("unknown").status, 0);
});

test("early reusable fault job runs the complete unchanged fixture before emitting candidate-bound evidence", () => {
  const workflow = YAML.parse(fs.readFileSync(".github/workflows/managed-fault.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_call"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_call.inputs), ["cold_caches", "source_sha"]);
  assert.deepEqual(workflow.on.workflow_call.inputs.cold_caches, {
    description: "Explicit PR/manual cache-miss measurement; acceptance work is unchanged",
    type: "boolean", required: false, default: false,
  });
  assert.equal(workflow.on.workflow_call.inputs.source_sha.required, true);
  assert.equal(workflow.on.workflow_call.outputs.fault_receipt.value, "${{ jobs.fault.outputs.fault_receipt }}");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["fault"]);
  const job = workflow.jobs.fault;
  assert.equal(job.needs, undefined, "caller preparation is the only prerequisite");
  assert.deepEqual(job.env, { CARGO_PROFILE_TEST_DEBUG: "0", CARGO_PROFILE_DEV_DEBUG: "0" });
  assert.equal(job.outputs.fault_receipt, "${{ steps.receipt.outputs.fault_receipt }}");
  assert.equal(job.steps[0].with.ref, "${{ inputs.source_sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.ok(job.steps.some(s => s.uses === "dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0" && s.with.components === "clippy"));
  assert.ok(job.steps.some(s => s.uses === "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020" && s.with["node-version"] === "24.22.1"));
  const cache = job.steps.find(s => s.uses?.startsWith("Swatinem/rust-cache@"));
  assert.equal(cache.uses, "Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4");
  assert.equal(cache.with.key, "managed-fault");
  assert.equal(cache.with["save-if"], "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}");
  const fixture = job.steps.findIndex(s => s.id === "fixture");
  const evidence = job.steps.findIndex(s => s.id === "receipt");
  assert.ok(fixture > 0 && evidence > fixture);
  assert.equal(job.steps[fixture].run, "make test-managed-fault-fixture");
  assert.equal(job.steps.filter(s => s.run === "make test-managed-fault-fixture").length, 1);
  assert.equal(job.steps[evidence].run, 'node .github/scripts/managed-fault.mjs receipt >> "$GITHUB_OUTPUT"');
  assert.deepEqual(job.steps[evidence].env, { EXPECTED_SHA: "${{ inputs.source_sha }}", CHECKOUT_SHA: "${{ steps.candidate.outputs.sha }}", FIXTURE_RESULT: "${{ steps.fixture.outcome }}" });
  assert.match(job.steps.find(s => s.id === "candidate").run, /test "\$sha" = "\$EXPECTED_SHA"/);
  for (const step of job.steps) {
    assert.equal(step.if, undefined, "no condition can omit mandatory fixture or emit on failure");
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(step.permissions, undefined);
    assert.doesNotMatch(step.run ?? "", /make ci/);
  }
});

test("real Make fixture retains all three test filters and clippy; each failure prevents receipt emission", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-fault-wiring-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fakeCargo = path.join(root, "cargo.mjs");
  fs.writeFileSync(fakeCargo, `#!${process.execPath}\nimport fs from 'node:fs';\nconst file=process.env.CARGO_CALLS;\nconst calls=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];\ncalls.push(process.argv.slice(2));fs.writeFileSync(file,JSON.stringify(calls));\nif(calls.length===Number(process.env.FAIL_COMMAND_INDEX))process.exit(1);\n`);
  fs.chmodSync(fakeCargo, 0o755);
  const fixture = YAML.parse(fs.readFileSync(".github/workflows/managed-fault.yml", "utf8")).jobs.fault.steps.find(s => s.id === "fixture").run;
  for (let failed = 0; failed <= 4; failed++) {
    const calls = path.join(root, `calls-${failed}.json`);
    const output = path.join(root, `receipt-${failed}`);
    const result = spawnSync("bash", ["-e", "-c", `${fixture}\nnode .github/scripts/managed-fault.mjs receipt >> "$GITHUB_OUTPUT"`], { env: { ...env, CARGO: fakeCargo, CARGO_CALLS: calls, FAIL_COMMAND_INDEX: String(failed), GITHUB_OUTPUT: output }, encoding: "utf8" });
    const commands = JSON.parse(fs.readFileSync(calls, "utf8"));
    assert.equal(commands.length, failed || 4);
    if (failed) {
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(output), false, "a failed fixture cannot emit reusable evidence");
    } else {
      assert.equal(result.status, 0, result.stderr);
      const raw = fs.readFileSync(output, "utf8").trim().slice("fault_receipt=".length);
      verifyFaultReceipt(JSON.parse(raw), sha, context);
      assert.deepEqual(commands, [
        ["test", "--locked", "-p", "nac-core", "--features", "managed-fault-fixture", "managed_fault_fixture::tests"],
        ["test", "--locked", "-p", "nac-core", "--features", "managed-fault-fixture", "private_fixture_ack_failure_follows_real_commit_and_replay_is_once"],
        ["test", "--locked", "-p", "nac-server", "--features", "managed-fault-fixture", "private_monitor_fault_is_generation_scoped_once_and_subsequent_read_recovers"],
        ["clippy", "--locked", "-p", "nac-server", "--features", "managed-fault-fixture", "--lib", "--bins", "--", "-D", "warnings"],
      ]);
    }
  }
});

test("late controller validates both receipts before conditional work and joins the early result", () => {
  const workflow = name => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, "utf8"));
  const stable = workflow("stable-release");
  const early = stable.jobs["managed-fault"];
  assert.equal(early.needs, "prepare");
  assert.equal(early.uses, "./.github/workflows/managed-fault.yml");
  assert.equal(early.with.source_sha, "${{ needs.prepare.outputs.sha }}");
  const late = stable.jobs["managed-quality"];
  assert.deepEqual(late.needs, ["prepare", "quality", "managed-fault"]);
  assert.equal(late.with.fault_receipt, "${{ needs.managed-fault.outputs.fault_receipt }}");
  assert.equal(late.with.quality_receipt, "${{ needs.quality.outputs.quality_receipt }}");
  assert.ok(managedCallerJobs.includes("managed-fault"));
  assert.ok(stable.jobs.managed.needs.includes("managed-fault"));
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("managed-fault"));
  const quality = workflow("managed-quality");
  assert.equal(quality.on.workflow_call.inputs.fault_receipt.default, "");
  const steps = quality.jobs.quality.steps;
  const base = steps.findIndex(s => s.id === "quality-mode");
  const fault = steps.findIndex(s => s.id === "fault-mode");
  assert.equal(steps[base].if, undefined);
  assert.equal(steps[fault].if, undefined);
  assert.equal(steps[fault].env.FAULT_RECEIPT, "${{ inputs.fault_receipt }}");
  const full = "steps.quality-mode.outputs.mode == 'full' || steps.fault-mode.outputs.mode == 'full'";
  for (const step of steps.filter(s => s.uses?.startsWith("dtolnay/") || s.uses?.startsWith("Swatinem/") || s.run === "make test-managed-fault-fixture")) {
    assert.ok(steps.indexOf(step) > base && steps.indexOf(step) > fault);
    assert.equal(step.if, full);
  }
  assert.equal(steps.find(s => s.run === "make ci").if, "steps.quality-mode.outputs.mode == 'full'");
  const wrapper = workflow("managed-image");
  assert.equal(wrapper.on.workflow_dispatch, null);
  assert.equal(wrapper.on.workflow_call.inputs.fault_receipt, undefined, "standalone callers cannot supply a new skip input");
  assert.equal(wrapper.jobs.quality.with.fault_receipt, undefined);
});

test("combined blank and retry evidence preserves full standalone and current-attempt fixture execution", () => {
  const current = { ...context, run_attempt: "2" };
  const quality = attempt => qualityReceipt({
    ...Object.fromEntries(qualityJobs.map(job => [job, { result: "success" }])),
    prepare: { result: "success", outputs: { sha, run: "true" } },
  }, sha, { ...context, run_attempt: attempt });
  const fault = attempt => faultReceipt(sha, "success", sha, { ...context, run_attempt: attempt });
  for (const [base, feature, fullBase, fullFixture] of [
    [null, undefined, true, true],
    [quality("2"), fault("2"), false, false],
    [quality("2"), fault("1"), false, true],
    [quality("1"), fault("2"), true, true],
    [quality("1"), fault("1"), true, true],
    [quality("2"), undefined, false, true],
  ]) {
    const q = qualityMode(base, sha, current);
    const f = faultMode(feature, sha, current);
    assert.equal(q === "full", fullBase);
    assert.equal(q === "full" || f === "full", fullFixture);
  }
  for (const invalid of [null, {}, { ...fault("1"), fixture_result: "failure" }, { ...fault("1"), sha: "b".repeat(40) }, fault("3")]) {
    assert.throws(() => faultMode(invalid, sha, current));
  }
});
