import { reverseAdmission } from "./ci-admission-wiring.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { managedCallerJobs, imageJobs, managedJobs, qualityJobs, qualityReceipt, verifyQuality, qualityMode, requiredJobs, requireComplete } from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const workflow = name => { const value = YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")); if (name === "stable-release") reverseAdmission(value); return value; };
// Exact reviewed nomination; file digests checked against immutable Q and R sources.
const reviewedStartupSupplier = {
  "source_sha": "4b7a1f3e0bf6175a77c5ebf627fe965860e99976",
  "test_source_sha": "ba266ba1b3bea331768d91fc8a0b2ee66b484d01",
  "protocol_source_sha": "7325c48b3c9ec7036e255a6bd92f31c1a98c1607",
  "profile": "macos26",
  "suite": "startup",
  "scenario_count": 4,
  "scenarios": [
    "onboarding",
    "configuredLocal",
    "invalidConfig",
    "futureStore"
  ],
  "test_files": {
    "README.md": "39c0b3aec37188e18eb141ef5537711e6f60b1fd384920d47d248cfd19758ed9",
    "StartupJourneys.swift": "7b731b4c4f40f890fb62ed97652b9c6b480c4fda463770a9fe5a95b1f30eb4f8",
    "contract.py": "d159672bb8eda5d3bf4e5d462813452c83a673974749ed4f7f07b3bb9341b91b",
    "test_contract.py": "493457530363e6992941960a6de2911c65da463db7452deb17f3af24443f916d",
    "StartupAXGuard.swift": "3be7835fe8cf48164bcfae3d5e803a1423b188ba78512ccb658858486dfa4a18",
    "StartupAXReceipt.swift": "a25b94b791e2ff24cb15016b976f78cf366540d15382c01f9bce8ec585f93217",
    "AX-WITNESS-CONTRACT.md": "1041bcef5739ebc1fe146673f7460ab82448d13dbb763af93c78f9cbf53c3bf6",
    "test_ax_witness.py": "26e3fb9b290a03642e43eb07965564d2beb8013cc28d3294a6e07c946289cdc3",
    "AGENTS.md": "074ff7d390c45a739b80048cf155274607ba3db5da74183cd5e4f673286a20fe"
  },
  "protocol_files": {
    "Cargo.lock": "8eaf3c5626b70caa5c613f551b5f98ce4746a21bf438f2df13f21410c58eabfa",
    "crates/nac-server/Cargo.toml": "b909a14e90ef379a3335a8fec6b9c0408ff6f1a2be6b56b3b22644d31e1f10c3",
    "crates/nac-server/tests/desktop_schema_contract.rs": "0eb70e49c7aba12bdb8c8c350246e892e2a5418403ca14a55674f2419a0aab1e"
  }
};
function assertStartupSupplier(catalog) {
  assert.deepEqual(catalog["all-342-startup-macos26"], reviewedStartupSupplier);
}

const sha = "a".repeat(40);
const context = { run_id: "123", run_attempt: "1", repository: "arcee-ai/nac" };
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
  assert.deepEqual(stable.jobs["managed-quality"].needs, ["prepare", "quality", "managed-fault"]);
  assert.equal(stable.jobs["managed-image"].needs, "prepare");
  assert.deepEqual(stable.jobs.managed.needs, ["prepare", "managed-image", "managed-fault", "managed-quality"]);
  assert.equal(stable.jobs["managed-quality"].with.quality_receipt, "${{ needs.quality.outputs.quality_receipt }}");
  assert.equal(workflow("managed-quality").on.workflow_call.inputs.quality_receipt.default, "");
  assert.equal(managed.on.workflow_dispatch, null, "standalone has no caller-supplied skip/receipt inputs");
  const steps = workflow("managed-quality").jobs.quality.steps;
  const validate = steps.findIndex(s => s.run?.includes("pr-checks.mjs quality-mode"));
  const full = steps.findIndex(s => s.run === "make ci");
  const fault = steps.findIndex(s => s.run === "make test-managed-fault-fixture");
  assert.ok(validate >= 0 && full > validate && fault > full);
  assert.equal(steps[validate].if, undefined);
  assert.equal(steps[validate].env.QUALITY_RECEIPT, "${{ inputs.quality_receipt }}");
  assert.equal(steps[validate].env.EXPECTED_SHA, "${{ inputs.source_sha }}");
  assert.equal(steps[full].if, "steps.quality-mode.outputs.mode == 'full'");
  assert.equal(steps[fault].if, "steps.quality-mode.outputs.mode == 'full' || steps.fault-mode.outputs.mode == 'full'", "private fixture requires fresh full execution unless exact same-attempt early evidence validates");
  for (const step of steps) assert.equal(step["continue-on-error"], undefined);
});

test("browser binds the same committed bundle and independent drift gate without a second web build", () => {
  const steps = workflow("stable-release").jobs["test-server-web"].steps;
  assert.equal(steps.filter(s => s.run === "make test-assets").length, 1);
  assert.equal(steps.filter(s => /(?:npm run build|make test-e2e)/.test(s.run ?? "")).length, 0);
  const stable = workflow("stable-release");
  const browserJob = stable.jobs["browser-shards"];
  assert.deepEqual(browserJob.needs, ["prepare", "browser-binary", "browser-apt"]);
  assert.equal(browserJob.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.ok(requiredJobs.includes("browser"));
  assert.deepEqual(stable.jobs.test.needs, ["prepare", "quality", "browser"]);
  const browser = browserJob.steps.find(s => s.name === "Run production-embedded browser shard");
  assert.equal(browser.env.NAC_E2E_BINARY, "${{ steps.runtime.outputs.binary }}");
  assert.match(browser.run, /npm --prefix crates\/nac-server\/web run test:e2e/);
  assert.match(stable.jobs["browser-binary"].steps.find(s => s.id === "pack").run,
    /cargo build --locked -p nac-server --bin nac-web/);
  const makefile = readFileSync("Makefile", "utf8");
  assert.match(makefile, /test-assets: test-api-contract/);
  for (const output of ["assets/dist", "packages/nac-client/dist", "packages/nac-presentation/dist"]) assert.ok(makefile.includes(output));
  assert.match(makefile, /npm --prefix \$\(WEB_DIR\) run check:api/);
});

test("release-local guide drift runs before a reusable quality receipt", () => {
  const stable = workflow("stable-release");
  const step = stable.jobs["test-workspace"].steps.find(s =>
    s.run?.split("\n").some(line => line.trim() === "make test-nac-guide"));
  assert.ok(step, "every-PR workspace quality must check canonical guide source drift");
  assert.equal(step.if, undefined, "guide drift cannot be conditionally skipped");
  assert.equal(step["continue-on-error"], undefined);
  assert.ok(stable.jobs.quality.needs.includes("test-workspace"));
  assert.match(readFileSync("Makefile", "utf8"), /^test:.*\btest-nac-guide\b/m,
    "standalone managed full quality must check the same guide sources");
});

const trustedWrite = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
const readonlyBrowserCaches = new Set(["browser-binary", "browser-proof", "browser-shards"]);
test("compiler caches preserve independent roles and one trusted server/browser writer", () => {
  for (const file of ["stable-release", "managed-image", "managed-image-build", "managed-quality", "managed-fault", "macos-native"]) {
    const config = workflow(file);
    assert.equal(config.permissions.contents, "read");
    for (const [jobName, job] of Object.entries(config.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("Swatinem/rust-cache@")) {
          const readonly = file === "stable-release" && readonlyBrowserCaches.has(jobName);
          assert.equal(step.with["save-if"], readonly ? "false" : trustedWrite, `${file}/${jobName}`);
          assert.equal(step.with["prefix-key"], file === "stable-release"
            ? "${{ needs.prepare.outputs.cold_caches == 'true' && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}"
            : "${{ (github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request') && inputs.cold_caches == true && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}");
          assert.ok(step.with.key || step.with["shared-key"], file);
        }
        if (step.uses?.startsWith("actions/setup-node@")) assert.equal(step.with.cache, undefined, "implicit npm cache post-save is forbidden");
        if (step.uses?.startsWith("actions/checkout@")) assert.equal(step.with["persist-credentials"], false);
      }
    }
  }
  const build = workflow("managed-image-build").jobs["build-smoke"].steps.find(s => s.uses?.startsWith("docker/build-push-action@"));
  assert.equal(build.with["cache-from"], "${{ !((github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request') && inputs.cold_caches == true) && 'type=gha,scope=nac-managed-linux-amd64-v1' || '' }}");
  assert.equal(build.with["no-cache"], "${{ (github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request') && inputs.cold_caches == true }}");
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
  for (const job of ["test-server", "browser-apt", "browser", "quality", "source-security", "macos-native", "workflow-lint", ...managedCallerJobs]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const needs = Object.fromEntries([...requiredJobs, ...managedCallerJobs].map(name => [name, { result: "success" }]));
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
  const managed = workflow("managed-image-build");
  assert.deepEqual(managed.jobs["build-smoke"].needs, ["prepare", "contract"]);
  assert.deepEqual(managed.jobs.result.needs, imageJobs);
  assert.deepEqual(workflow("managed-image").jobs.result.needs, managedJobs);
  assert.equal(managed.permissions.contents, "read");
  assert.equal(managed.jobs["build-smoke"].permissions, undefined);
  const stable = workflow("stable-release");
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("managed"));
  assert.ok(stable.jobs.publish.needs.includes("required-pr-checks"));
});


test("immutable startup nomination rejects supplier, source-file and policy drift", () => {
  const catalog = JSON.parse(readFileSync("desktop/macos/ci-qualifications.json", "utf8"));
  assertStartupSupplier(catalog);
  for (const mutate of [
    s => { s.source_sha = "0".repeat(40); },
    s => { s.test_source_sha = "0".repeat(40); },
    s => { s.protocol_source_sha = "0".repeat(40); },
    s => { s.test_files["StartupJourneys.swift"] = "0".repeat(64); },
    s => { delete s.test_files["contract.py"]; },
    s => { s.protocol_files["Cargo.lock"] = "0".repeat(64); },
    s => { s.profile = "macos14"; },
    s => { s.scenario_count--; },
    s => { s.scenarios.reverse(); },
    s => { s.acceptance = true; },
  ]) {
    const value = structuredClone(catalog); mutate(value["all-342-startup-macos26"]);
    assert.throws(() => assertStartupSupplier(value));
  }
});
