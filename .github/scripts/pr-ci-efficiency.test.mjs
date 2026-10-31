import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { qualityJobs, qualityReceipt, verifyQuality, qualityMode, requiredJobs, requireComplete } from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const workflow = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const sha = "a".repeat(40);
const context = { run_id: "123", run_attempt: "1", repository: "arcee-ai/nac" };

test("exact native supplier qualification is explicit, bounded and separate from publication", () => {
  const stable = workflow("stable-release");
  const input = stable.on.workflow_dispatch.inputs.native_qualification;
  assert.equal(input.default, "none");
  assert.deepEqual(input.options, ["none", "all-341-macos26", "all-343-macos26", "all-351-macos14", "all-352-macos26"]);
  const caller = stable.jobs["native-qualification"];
  assert.match(caller.if, /github.event_name == 'workflow_dispatch'/);
  assert.match(caller.if, /startsWith\(github.ref, 'refs\/heads\/codex\/'\)/);
  assert.match(caller.if, /inputs.native_qualification == 'all-341-macos26'/);
  assert.match(caller.if, /inputs.native_qualification == 'all-343-macos26'/);
  assert.equal(caller.with["harness-sha"], "${{ needs.prepare.outputs.sha }}");
  assert.equal(caller.uses, "./.github/workflows/macos-qualification.yml");
  assert.equal(requiredJobs.includes("native-qualification"), false);
  assert.match(stable.jobs.publish.if, /github.event_name == 'push'/);
  assert.match(stable.jobs.publish.if, /startsWith\(github.ref, 'refs\/tags\/v'\)/);
  const exact = workflow("macos-qualification");
  assert.deepEqual(exact.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(exact.jobs).sort(), ["native", "resolve"]);
  assert.equal(exact.jobs.native.strategy, undefined);
  assert.equal(exact.jobs.native["timeout-minutes"], 40);
  const checkouts = exact.jobs.native.steps.filter(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkouts.length, 2);
  assert.deepEqual(checkouts.map(step => step.with.path), ["ci-harness", "qualification-target"]);
  assert.ok(checkouts.every(step => step.with["persist-credentials"] === false));
  assert.equal(checkouts[0].with.ref, "${{ inputs.harness-sha }}");
  assert.equal(checkouts[1].with.ref, "${{ needs.resolve.outputs.source_sha }}");
  assert.ok(exact.jobs.native.steps.some(step => step.if === "always()" && step.uses?.startsWith("actions/upload-artifact@")));
  const catalog = JSON.parse(readFileSync("desktop/macos/ci-qualifications.json", "utf8"));
  assert.equal(catalog["all-341-macos26"].source_sha, "1a4f9c31f27b4656897673084f3440e05373393d");
  assert.equal(catalog["all-341-macos26"].profile, "macos26");
  assert.equal(catalog["all-343-macos26"].source_sha, "0d78ee389e98c0f157a8e8313446fc8006c38ec4");
  assert.equal(catalog["all-343-macos26"].scenario_count, 8);
  assert.equal(catalog["all-351-macos14"].source_sha, "fa94a859b648cb36fbdcb251bfe4bc9541de3f48");
  assert.equal(catalog["all-351-macos14"].profile, "macos14");
  assert.equal(catalog["all-352-macos26"].source_sha, "24c0179f9e42a36d021a117694f098a76a3ddb80");
  assert.equal(catalog["all-352-macos26"].phase_count, 6);
});

const quality = () => ({
  ...Object.fromEntries(qualityJobs.map(job => [job, { result: "success" }])),
  prepare: { result: "success", outputs: { sha, run: "true" } },
});

test("same-run quality reuse rejects partial, stale, failed, skipped and foreign receipts", () => {
  const receipt = qualityReceipt(quality(), sha, context);
  verifyQuality(receipt, sha, context);
  for (const job of qualityJobs) {
    for (const result of ["failure", "cancelled", "skipped", "pending", undefined]) {
      const needs = quality();
      needs[job].result = result;
      assert.throws(() => qualityReceipt(needs, sha, context), undefined, `${job}/${result}`);
      assert.throws(() => verifyQuality({ ...receipt, results: { ...receipt.results, [job]: result } }, sha, context));
    }
    const needs = quality();
    delete needs[job];
    assert.throws(() => qualityReceipt(needs, sha, context));
  }
  for (const field of ["sha", "run_id", "run_attempt", "repository"]) {
    assert.throws(() => verifyQuality({ ...receipt, [field]: "other" }, sha, context), undefined, field);
  }
  for (const invalid of [null, {}, { ...receipt, extra: true }, { ...receipt, results: {} }]) {
    assert.throws(() => verifyQuality(invalid, sha, context));
  }
  assert.throws(() => qualityReceipt(quality(), "b".repeat(40), context));
  assert.throws(() => qualityReceipt({ ...quality(), extra: { result: "success" } }, sha, context));
});

test("real receipt CLI carries only completed exact-run results and fails closed before reuse", () => {
  const env = { ...process.env, EXPECTED_SHA: sha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "arcee-ai/nac", NEEDS_JSON: JSON.stringify(quality()) };
  const run = (command, extra = {}) => spawnSync(process.execPath, [".github/scripts/pr-checks.mjs", command], { encoding: "utf8", env: { ...env, ...extra } });
  const created = run("quality-receipt");
  assert.equal(created.status, 0, created.stderr);
  const value = created.stdout.trim().slice("quality_receipt=".length);
  assert.equal(run("verify-quality", { QUALITY_RECEIPT: value }).status, 0);
  for (const override of [{ GITHUB_RUN_ID: "124" }, { GITHUB_RUN_ATTEMPT: "2" }, { EXPECTED_SHA: "b".repeat(40) }, { GITHUB_REPOSITORY: "attacker/nac" }]) {
    assert.notEqual(run("verify-quality", { QUALITY_RECEIPT: value, ...override }).status, 0);
  }
  assert.notEqual(run("verify-quality", { QUALITY_RECEIPT: "true" }).status, 0);
});

test("caller supplies observed complete quality needs; standalone always runs full quality", () => {
  const stable = workflow("stable-release");
  const managed = workflow("managed-image");
  assert.deepEqual([...stable.jobs.quality.needs].sort(), [...qualityJobs].sort());
  const receipt = stable.jobs.quality.steps.find(s => s.id === "receipt");
  assert.equal(receipt.env.NEEDS_JSON, "${{ toJSON(needs) }}");
  assert.equal(receipt.env.EXPECTED_SHA, "${{ needs.prepare.outputs.sha }}");
  assert.match(receipt.run, /pr-checks.mjs quality-receipt/);
  assert.deepEqual(stable.jobs.managed.needs, ["prepare", "quality"]);
  assert.equal(stable.jobs.managed.with.quality_receipt, "${{ needs.quality.outputs.quality_receipt }}");
  assert.equal(managed.on.workflow_call.inputs.quality_receipt.default, "");
  assert.equal(managed.on.workflow_dispatch, null, "standalone has no caller-supplied skip/receipt inputs");
  const steps = managed.jobs.quality.steps;
  const validate = steps.findIndex(s => s.run?.includes("pr-checks.mjs quality-mode"));
  const full = steps.findIndex(s => s.run === "make ci");
  const fault = steps.findIndex(s => s.run === "make test-managed-fault-fixture");
  assert.ok(validate >= 0 && full > validate && fault > full);
  assert.equal(steps[validate].if, undefined);
  assert.equal(steps[validate].env.QUALITY_RECEIPT, "${{ inputs.quality_receipt }}");
  assert.equal(steps[validate].env.EXPECTED_SHA, "${{ needs.prepare.outputs.sha }}");
  assert.equal(steps[full].if, "steps.quality-mode.outputs.mode == 'full'");
  assert.equal(steps[fault].if, undefined, "feature-gated fault tests are never deduplicated");
  for (const step of steps) assert.equal(step["continue-on-error"], undefined);
});

test("browser binds the same committed bundle and independent drift gate without a second web build", () => {
  const steps = workflow("stable-release").jobs["test-server"].steps;
  assert.equal(steps.filter(s => s.run === "make test-assets").length, 1);
  assert.equal(steps.filter(s => /(?:npm run build|make test-e2e)/.test(s.run ?? "")).length, 0);
  const stable = workflow("stable-release");
  const browserJob = stable.jobs.browser;
  assert.equal(browserJob.needs, "prepare");
  assert.equal(browserJob.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.ok(requiredJobs.includes("browser"));
  assert.deepEqual(stable.jobs.test.needs, ["prepare", "quality", "browser"]);
  const browser = browserJob.steps.find(s => s.name === "Run production-embedded browser tests");
  assert.match(browser.run, /cargo build --locked -p nac-server --bin nac-web/);
  assert.match(browser.run, /NAC_E2E_BINARY="\$GITHUB_WORKSPACE\/target\/debug\/nac-web" npm --prefix crates\/nac-server\/web run test:e2e/);
  const makefile = readFileSync("Makefile", "utf8");
  assert.match(makefile, /test-assets: test-api-contract/);
  for (const output of ["assets/dist", "packages/nac-client/dist", "packages/nac-presentation/dist"]) assert.ok(makefile.includes(output));
  assert.match(makefile, /npm --prefix \$\(WEB_DIR\) run check:api/);
});

const trustedWrite = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
test("compiler caches isolate job/profile/toolchain and PRs cannot save npm/Cargo/container caches", () => {
  for (const file of ["stable-release", "managed-image", "macos-native"]) {
    const config = workflow(file);
    assert.equal(config.permissions.contents, "read");
    for (const job of Object.values(config.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("Swatinem/rust-cache@")) {
          assert.equal(step.with["save-if"], trustedWrite, file);
          assert.equal(step.with["prefix-key"], "nac-ci-v1");
          assert.ok(step.with.key || step.with["shared-key"], file);
        }
        if (step.uses?.startsWith("actions/setup-node@")) assert.equal(step.with.cache, undefined, "implicit npm cache post-save is forbidden");
        if (step.uses?.startsWith("actions/checkout@")) assert.equal(step.with["persist-credentials"], false);
      }
    }
  }
  const build = workflow("managed-image").jobs["build-smoke"].steps.find(s => s.uses?.startsWith("docker/build-push-action@"));
  assert.equal(build.with["cache-from"], "type=gha,scope=nac-managed-linux-amd64-v1");
  assert.equal(build.with["cache-to"], "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') && 'type=gha,mode=max,scope=nac-managed-linux-amd64-v1' || '' }}");
  assert.equal(build.with.push, false);
  assert.equal(workflow("stable-release").jobs.publish.permissions.contents, "write");
});

test("PR identity cancels superseded checks while tag/push/dispatch/release mutations never share a slot", () => {
  const stable = workflow("stable-release");
  assert.equal(stable.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' && (github.event.action == 'synchronize' || github.event.changes.base != null) }}");
  assert.equal(stable.concurrency.group, "${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}");
  // The exact expression above chooses the PR number only for ordinary PR events.
  const identity = (event, pr, run) => event === "pull_request" ? `Stable release-pr-${pr}` : `Stable release-run-${run}`;
  assert.equal(identity("pull_request", 412, 1), identity("pull_request", 412, 2));
  assert.notEqual(identity("pull_request", 412, 1), identity("pull_request", 413, 2));
  for (const event of ["push", "workflow_dispatch"]) assert.notEqual(identity(event, 0, 1), identity(event, 0, 2));
  const cancels = (event, action, baseChanged = false) => event === "pull_request" && (action === "synchronize" || baseChanged);
  assert.equal(cancels("pull_request", "synchronize"), true);
  assert.equal(cancels("pull_request", "edited", true), true);
  for (const action of ["edited", "ready_for_review", "reopened", "opened"]) assert.equal(cancels("pull_request", action), false);
  for (const event of ["push", "workflow_dispatch"]) assert.equal(cancels(event, "synchronize", true), false);
  assert.equal(workflow("release-please").concurrency["cancel-in-progress"], false);
  assert.equal(workflow("managed-image").concurrency["cancel-in-progress"], false);
  assert.match(stable.jobs.publish.if, /github.event_name == 'push'/);
});

test("seeded browser/source/native/image failures still fail the full current-candidate aggregate", () => {
  for (const job of ["test-server", "browser", "quality", "source-security", "macos-native", "workflow-lint", "managed"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const needs = Object.fromEntries([...requiredJobs, "managed"].map(name => [name, { result: "success" }]));
      needs.prepare.outputs = { sha, run: "true" };
      needs[job].result = result;
      assert.throws(() => requireComplete(needs, "true", sha), undefined, `${job}/${result}`);
    }
  }
});

test("failed-job reruns repeat full quality for a valid earlier attempt without reusing stale evidence", () => {
  const receipt = qualityReceipt(quality(), sha, context);
  assert.equal(qualityMode(null, sha, context), "full");
  assert.equal(qualityMode(receipt, sha, context), "reuse");
  assert.equal(qualityMode(receipt, sha, { ...context, run_attempt: "2" }), "full");
  assert.throws(() => verifyQuality(receipt, sha, { ...context, run_attempt: "2" }));
  for (const [field, value] of [["sha", "b".repeat(40)], ["repository", "other/repo"], ["run_id", "124"], ["run_attempt", "3"]]) {
    assert.throws(() => qualityMode({ ...receipt, [field]: value }, sha, { ...context, run_attempt: "2" }));
  }
  for (const result of ["failure", "skipped", "cancelled", undefined]) {
    assert.throws(() => qualityMode({ ...receipt, results: { ...receipt.results, lint: result } }, sha, { ...context, run_attempt: "2" }));
  }
  const run = value => spawnSync(process.execPath, [".github/scripts/pr-checks.mjs", "quality-mode"], {
    encoding: "utf8", env: { ...process.env, EXPECTED_SHA: sha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_REPOSITORY: "arcee-ai/nac", QUALITY_RECEIPT: value },
  });
  assert.equal(run(JSON.stringify(receipt)).stdout.trim(), "mode=full");
  assert.equal(run("").stdout.trim(), "mode=full");
  assert.notEqual(run(JSON.stringify({ ...receipt, run_id: "124" })).status, 0);
});

test("unprivileged image verification overlaps fault compilation but final managed and publication gates require both", () => {
  const managed = workflow("managed-image");
  assert.deepEqual(managed.jobs["build-smoke"].needs, ["prepare", "contract"]);
  assert.deepEqual(managed.jobs.result.needs, ["prepare", "contract", "quality", "build-smoke"]);
  assert.equal(managed.permissions.contents, "read");
  assert.equal(managed.jobs["build-smoke"].permissions, undefined);
  const stable = workflow("stable-release");
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("managed"));
  assert.ok(stable.jobs.publish.needs.includes("required-pr-checks"));
});
