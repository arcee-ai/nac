import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Existing locked workflow-parser dependency.
const workflow = YAML.parse(fs.readFileSync(".github/workflows/macos-package.yml", "utf8"));
const stable = YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));
const job = workflow.jobs.normal;
const runs = job.steps.filter(step => step.run);
const packageSteps = runs.filter(step => /python3 -B desktop\/macos\/packaging\/package.py /.test(step.run));

test("engine identity compiler support changes reach package preparation", () => {
  const build = fs.readFileSync("crates/nac-server/build.rs", "utf8");
  const imported = build.match(/^#\[path = "([^"]+)"\]\nmod build_identity;/m);
  assert.ok(imported, "inspect the engine identity support owner if its import changes");
  const support = path.posix.normalize(path.posix.join("crates/nac-server", imported[1]));
  assert.equal(support, "scripts/build-identity.rs");
  assert.ok(workflow.on.pull_request.paths.includes(support), `missing compiler input trigger: ${support}`);
});

test("base retarget rebuilds the merge candidate while metadata-only edits skip the Mac job", () => {
  assert.deepEqual(workflow.on.pull_request.types,
    ["opened", "synchronize", "reopened", "ready_for_review", "edited"]);
  // This is a bounded truth table for this one literal guard, not an Actions
  // expression interpreter. First require its exact supported operators/tokens.
  assert.equal(job.if, "${{ github.event_name != 'pull_request' || github.event.action != 'edited' || github.event.changes.base != null }}");
  const base = { ref: { from: "old-base" }, sha: { from: "a".repeat(40) } };
  const cases = [
    ...["opened", "synchronize", "reopened", "ready_for_review"].map(action =>
      ({ event: "pull_request", payload: { action }, expected: true })),
    { event: "workflow_dispatch", payload: {}, expected: true },
    { event: "pull_request", payload: { action: "edited", changes: { base } }, expected: true },
    { event: "pull_request", payload: { action: "edited", changes: { base, body: { from: "old body" } } }, expected: true },
    { event: "pull_request", payload: { action: "edited", changes: { body: { from: "old BugBot summary" } } }, expected: false },
    { event: "pull_request", payload: { action: "edited", changes: { title: { from: "old title" } } }, expected: false },
    { event: "pull_request", payload: { action: "edited", changes: { base: null } }, expected: false },
    { event: "pull_request", payload: { action: "edited" }, expected: false },
  ];
  for (const { event, payload, expected } of cases) {
    const expression = job.if.slice(3, -2)
      .replaceAll("github.event_name", JSON.stringify(event))
      .replaceAll("github.event.action", JSON.stringify(payload.action ?? null))
      .replaceAll("github.event.changes.base", JSON.stringify(payload.changes?.base ?? null));
    assert.equal(runInNewContext(expression, {}, { timeout: 100 }), expected, JSON.stringify({ event, payload }));
  }
});

test("preparation keeps PR/manual authority separate from stable publication", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(workflow.jobs), ["normal"]);
  assert.equal(job["runs-on"], "macos-26");
  assert.equal(job["continue-on-error"], undefined);
  const approved = new Set(Object.values(stable.jobs).flatMap(value =>
    (value.steps ?? []).filter(step => step.uses).map(step => step.uses)));
  for (const step of job.steps.filter(step => step.uses)) {
    assert.match(step.uses, /@[a-f0-9]{40}$/);
    assert.ok(approved.has(step.uses), `action must already be approved: ${step.uses}`);
  }
  const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const cache = job.steps.find(step => step.uses?.startsWith("Swatinem/rust-cache@"));
  assert.equal(cache.with["save-if"], "${{ false }}");
  assert.doesNotMatch(YAML.stringify(workflow), /secrets\.|contents: write|pull_request_target|workflow_run|gh release|notarytool|security import/);
  // Engine, schema, assets and version changes must reach this independent lane.
  for (const input of ["crates/**", "desktop/macos/**", "Cargo.lock", "Cargo.toml", "version.txt", "Makefile"])
    assert.ok(workflow.on.pull_request.paths.includes(input), input);
});

test("exact-source guard rejects mismatched revision, dirty source and wrong host before actors", () => {
  const guard = runs.find(step => step.env?.EXPECTED_SHA);
  assert.equal(guard.env.EXPECTED_SHA, "${{ github.sha }}");
  const invoke = (overrides = {}) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", `
    git() {
      case "$1" in rev-parse) printf '%s' "$CONTROL_SHA";;
        status) printf '%s' "$CONTROL_DIRTY";; *) return 71;; esac
    }
    uname() { if [ "$1" = -s ]; then printf '%s' "$CONTROL_OS"; else printf '%s' "$CONTROL_ARCH"; fi; }
    ${guard.run}
  `], { encoding: "utf8", env: { ...process.env, EXPECTED_SHA: "a".repeat(40),
    CONTROL_SHA: "a".repeat(40), CONTROL_DIRTY: "", CONTROL_OS: "Darwin", CONTROL_ARCH: "arm64", ...overrides } });
  assert.equal(invoke().status, 0);
  for (const mutation of [{ CONTROL_SHA: "b".repeat(40) }, { CONTROL_DIRTY: "?? unexpected" },
    { CONTROL_OS: "Linux" }, { CONTROL_ARCH: "x86_64" }])
    assert.notEqual(invoke(mutation).status, 0, JSON.stringify(mutation));
});

test("one engine feeds only canonical normal preparation and the same verified relocated container", () => {
  const commands = packageSteps.map(step => step.run.match(/package.py ([a-z-]+)/)[1]);
  assert.deepEqual(commands, ["prepare-engine", "normal", "verify", "relocate-check"]);
  const setup = runs.findIndex(step => step.run.trim() === "make setup");
  assert.ok(setup >= 0 && setup < runs.indexOf(packageSteps[0]));
  assert.match(packageSteps[0].run, /prepare-engine --track dev/);
  assert.match(packageSteps[1].run, /--engine-receipt "\$RUNNER_TEMP\/package-engine\/engine-build.json"/);
  for (const step of packageSteps.slice(2))
    assert.match(step.run, /"\$RUNNER_TEMP\/package-normal\/manifest.json"/);
  assert.match(packageSteps[2].run, /--signatures/);
  assert.doesNotMatch(runs.map(step => step.run).join("\n"), /cargo build|npm .*build|app-run|smoke|lifecycle-build|fixture|xcodebuild|distribution-plan|verify-developer-id/);
  const upload = job.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.if, "always()");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(upload.with.name, "mac-package-adhoc-preparation-${{ github.sha }}");
  for (const evidence of ["package-engine/engine-build.json", "package-normal/manifest.json",
    "package-normal/NAC-normal-app-preparation-arm64.zip", "package-normal-relocation/relocation.json", "package-*.log"])
    assert.ok(upload.with.path.includes(`\${{ runner.temp }}/${evidence}`), evidence);
});

test("logged package commands retain failure evidence and fail the step rather than tee masking errors", () => {
  // Explicit GHA bash uses -e -o pipefail; unspecified default bash lacks the
  // pipefail guarantee, so a successful tee could conceal a producer failure.
  assert.equal(job.defaults.run.shell, "bash");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nac-package-ci-control-"));
  try {
    // Run actual workflow shell bodies; replace only the Python actor with an
    // inert diagnostic failure. Neither package code nor native tools execute.
    for (const step of packageSteps) {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c",
        `python3() { printf '%s\\n' 'synthetic actor refusal'; return 73; }\n${step.run}`],
      { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: temporary } });
      assert.equal(result.status, 73, result.stderr);
      assert.match(result.stdout, /synthetic actor refusal/);
    }
    assert.equal(fs.readdirSync(temporary).filter(name => name.endsWith(".log")).length, packageSteps.length);
    for (const file of fs.readdirSync(temporary))
      assert.match(fs.readFileSync(path.join(temporary, file), "utf8"), /synthetic actor refusal/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
