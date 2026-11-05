import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { codeowners } from "./pr-ruleset.mjs";
import { ownerArtifacts } from "./update-codeowners.mjs";
import {
  managedApplicable,
  requiredJobs,
  requireComplete,
  managedJobs,
  requireManagedComplete,
  CancelledCandidate,
  findQualifiedRun,
} from "./pr-checks.mjs";

const sha = "a".repeat(40);
function successful(managed = "success") {
  const needs = Object.fromEntries(requiredJobs.map((job) => [job, { result: "success" }]));
  needs.prepare.outputs = { sha, run: "true" };
  needs.managed = { result: managed };
  return needs;
}

test("event/path matrix explicitly selects managed work without filtering the required workflow", () => {
  for (const path of [
    "Cargo.lock",
    "crates/nac-process/src/lib.rs",
    "crates/nac-server/web/src/main.tsx",
    ".github/workflows/stable-release.yml",
    "docker/managed/Dockerfile",
    "scripts/smoke-managed-terminal.py",
    "scripts/smoke-managed-git-lfs.sh",
    "Makefile",
    ".dockerignore",
  ]) {
    assert.equal(managedApplicable([path]), true, path);
    requireComplete(successful(), "true", sha);
  }
  for (const paths of [
    ["README.md"],
    ["docs/architecture/example.md"],
    [],
    ["docs/file with\nnewline.md"],
  ]) {
    assert.equal(managedApplicable(paths), false);
    requireComplete(successful("skipped"), "false", sha);
  }
  assert.equal(managedApplicable(["README.md", "Cargo.toml"]), true);
});

test("real Git renames out of managed inputs cannot skip the managed graph", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-pr-rename-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.name", "NAC policy test");
    git("config", "user.email", "policy@example.invalid");
    fs.writeFileSync(path.join(directory, ".dockerignore"), "target/\n");
    git("add", ".dockerignore");
    git("commit", "-qm", "managed input");
    const base = git("rev-parse", "HEAD").trim();
    fs.mkdirSync(path.join(directory, "docs"));
    git("mv", ".dockerignore", "docs/dockerignore.md");
    git("commit", "-qm", "move outside managed paths");
    const workflow = fs.readFileSync(".github/workflows/stable-release.yml", "utf8");
    const flags = workflow
      .match(/git diff (.*) "\$BASE_SHA" HEAD > "\$RUNNER_TEMP\/pr-paths"/)[1]
      .split(" ");
    const paths = git("diff", ...flags, base, "HEAD")
      .split("\0")
      .filter(Boolean);
    assert.ok(paths.includes(".dockerignore"));
    assert.ok(paths.includes("docs/dockerignore.md"));
    assert.equal(managedApplicable(paths), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("every failed, cancelled, pending, missing or unexpectedly skipped job fails closed", () => {
  for (const job of [...requiredJobs, "managed"]) {
    for (const result of ["failure", "cancelled", "skipped", "pending", "neutral", "", undefined]) {
      const needs = successful();
      needs[job].result = result;
      assert.throws(() => requireComplete(needs, "true", sha), undefined, `${job}: ${result}`);
    }
    const needs = successful();
    delete needs[job];
    assert.throws(() => requireComplete(needs, "true", sha));
  }
  assert.throws(() =>
    requireComplete({ ...successful(), surprise: { result: "success" } }, "true", sha),
  );
  for (const applicability of [undefined, "", "yes", "TRUE"]) {
    assert.throws(() => requireComplete(successful(), applicability, sha));
  }
  assert.throws(() => requireComplete(successful(), "false", sha));
});

test("a green previous candidate or absent preparation cannot satisfy the current candidate", () => {
  assert.throws(() => requireComplete(successful(), "true", "b".repeat(40)));
  assert.throws(() => requireComplete(successful(), "true", ""));
  const needs = successful();
  needs.prepare.outputs.run = "false";
  assert.throws(() => requireComplete(needs, "true", sha));
});

// Shape of superseded run 40435629331: prepare cancelled, reusable jobs skipped.
function supersededRun() {
  const needs = Object.fromEntries(requiredJobs.map((job) => [job, { result: "cancelled" }]));
  needs["source-security"].result = "skipped";
  needs["macos-native"].result = "skipped";
  needs.managed = { result: "skipped" };
  return needs;
}

test("a superseded run is reported as cancellation, not as an unbound candidate", () => {
  assert.throws(
    () => requireComplete(supersededRun(), "", sha),
    (error) => error instanceof CancelledCandidate && /prepare.*cancelled, and no job failed/.test(error.message),
  );
  const managed = Object.fromEntries(managedJobs.map((job) => [job, { result: "cancelled" }]));
  assert.throws(() => requireManagedComplete(managed, sha), CancelledCandidate);
});

test("quality and test failing only because a dependency was cancelled is still cancellation", () => {
  const cancelledMidRun = () => ({
    ...successful(),
    lint: { result: "cancelled" },
    quality: { result: "failure" },
    test: { result: "failure" },
    managed: { result: "skipped" },
  });
  assert.throws(
    () => requireComplete(cancelledMidRun(), "true", sha),
    (error) => error instanceof CancelledCandidate && /^lint did not succeed/.test(error.message),
  );

  // Logged by run 41738348755, cancelled during managed build-smoke.
  const managedOnly = { ...successful(), managed: { result: "cancelled", outputs: {} } };
  assert.throws(() => requireComplete(managedOnly, "true", sha), CancelledCandidate);

  const browserOnly = { ...successful(), browser: { result: "cancelled" }, test: { result: "failure" } };
  assert.throws(() => requireComplete(browserOnly, "true", sha), CancelledCandidate);

  const realFailure = { ...cancelledMidRun(), build: { result: "failure" } };
  assert.throws(
    () => requireComplete(realFailure, "true", sha),
    (error) => !(error instanceof CancelledCandidate) && /^build did not succeed; also cancelled: lint$/.test(error.message),
  );
  const managedFailure = { ...cancelledMidRun(), managed: { result: "failure" } };
  assert.throws(() => requireComplete(managedFailure, "true", sha), /^Error: managed did not succeed/);

  const summaryFailed = { ...successful(), quality: { result: "failure" }, test: { result: "failure" } };
  assert.throws(() => requireComplete(summaryFailed, "true", sha), /^Error: quality, test did not succeed$/);
  const browserFailed = { ...successful(), browser: { result: "failure" }, test: { result: "failure" } };
  assert.throws(() => requireComplete(browserFailed, "true", sha), /^Error: browser, test did not succeed$/);
});

test("a genuine failure stays visible beside cancellations and is never called cancellation", () => {
  const needs = supersededRun();
  needs.browser.result = "failure";
  needs.lint.result = "failure";
  assert.throws(
    () => requireComplete(needs, "", sha),
    (error) =>
      !(error instanceof CancelledCandidate) &&
      /^browser, lint did not succeed; also cancelled: .*prepare/.test(error.message),
  );
  const prepareFailed = successful();
  prepareFailed.prepare = { result: "failure" };
  assert.throws(() => requireComplete(prepareFailed, "", sha), /^Error: prepare did not succeed$/);
});

test("the aggregate command stays red for a cancelled candidate and labels it", () => {
  const run = (needs, applicability = "") =>
    spawnSync(process.execPath, [new URL("./pr-checks.mjs", import.meta.url).pathname, "aggregate"], {
      encoding: "utf8",
      env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), MANAGED_APPLICABLE: applicability, EXPECTED_SHA: sha },
    });
  const cancelled = run(supersededRun());
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stdout, /^::warning title=Cancelled run with no failed job::/);

  const failed = supersededRun();
  failed.browser.result = "failure";
  const genuine = run(failed);
  assert.notEqual(genuine.status, 0);
  assert.doesNotMatch(genuine.stdout, /Cancelled run/);
  assert.match(genuine.stderr, /browser did not succeed/);

  assert.equal(run(successful(), "true").status, 0);
  assert.notEqual(run(successful(), "").status, 0);
});

function reusedRun() {
  const needs = Object.fromEntries(requiredJobs.map((job) => [job, { result: "skipped" }]));
  needs.prepare = { result: "success", outputs: { sha, run: "false", reused_run: "42" } };
  needs["source-security"].result = "success";
  needs.managed = { result: "skipped" };
  return needs;
}

test("a metadata run satisfies the gate only when it bound a reused run and ran nothing else", () => {
  requireComplete(reusedRun(), "true", sha, "1");
  assert.throws(() => requireComplete(reusedRun(), "true", sha, "2"), /re-run all jobs/);

  const unbound = reusedRun();
  delete unbound.prepare.outputs.reused_run;
  assert.throws(() => requireComplete(unbound, "true", sha, "1"), /did not bind/);

  const stillRun = reusedRun();
  stillRun.prepare.outputs.run = "true";
  assert.throws(() => requireComplete(stillRun, "true", sha, "1"), /did not bind/);

  const otherCandidate = reusedRun();
  otherCandidate.prepare.outputs.sha = "b".repeat(40);
  assert.throws(() => requireComplete(otherCandidate, "true", sha, "1"), /did not bind/);

  const invalid = reusedRun();
  invalid.prepare.outputs.reused_run = "42; true";
  assert.throws(() => requireComplete(invalid, "true", sha, "1"), /invalid reused run/);

  const scanFailed = reusedRun();
  scanFailed["source-security"].result = "failure";
  assert.throws(() => requireComplete(scanFailed, "true", sha, "1"), /source-security did not succeed/);

  const scanSkipped = reusedRun();
  scanSkipped["source-security"].result = "skipped";
  assert.throws(() => requireComplete(scanSkipped, "true", sha, "1"), /source-security must be success/);

  const ranAnyway = reusedRun();
  ranAnyway.browser.result = "success";
  assert.throws(() => requireComplete(ranAnyway, "true", sha, "1"), /browser must be skipped/);
});

test("only a full run of this exact candidate with nothing newer failed can be reused", async () => {
  const headSha = "c".repeat(40);
  const baseSha = "d".repeat(40);
  const run = (id, change = {}) => ({
    id,
    run_number: id,
    run_attempt: 1,
    updated_at: `2026-11-04T10:00:${String(id % 60).padStart(2, "0")}Z`,
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/stable-release.yml",
    pull_requests: [{ number: 7, base: { sha: baseSha }, head: { sha: headSha } }],
    ...change,
  });
  const marker = (id, change = {}) => ({ expired: false, workflow_run: { id, head_sha: headSha }, ...change });
  const lookup = async ({ artifacts = [marker(42)], runs = [run(42)], status = 200, startedJobs = 3, ...input } = {}) => {
    const urls = [];
    const fetcher = async (url) => {
      urls.push(url);
      const body = url.includes("/artifacts?")
        ? { artifacts }
        : url.endsWith("/jobs")
          ? { total_count: startedJobs }
          : { workflow_runs: runs };
      return { ok: status === 200, status, json: async () => body };
    };
    const found = await findQualifiedRun(
      { repository: "o/r", mergeSha: sha, headSha, baseSha, prNumber: "7", parents: [baseSha, headSha], currentRun: "99", currentAttempt: "1", token: "t", ...input },
      fetcher,
    );
    return { found, urls };
  };

  const reused = await lookup();
  assert.equal(reused.found, "42");
  assert.match(reused.urls[0], new RegExp(`artifacts\\?name=qualified-${sha}&`));
  assert.match(reused.urls[1], new RegExp(`runs\\?head_sha=${headSha}&event=pull_request`));

  assert.equal((await lookup({ currentAttempt: "2" })).found, null);
  assert.equal((await lookup({ runs: [run(42), run(50, { conclusion: "cancelled" })], startedJobs: 0 })).found, "42");
  assert.equal((await lookup({ runs: [run(42), run(50, { conclusion: "failure" })], startedJobs: 0 })).found, null);
  const cancelledRerun = run(50, { conclusion: "cancelled", run_attempt: 2 });
  assert.equal((await lookup({ runs: [run(42), cancelledRerun], startedJobs: 0 })).found, null);
  // A failed rerun of an older run counts, because it finished after the marker run.
  const rerunFailed = run(40, { conclusion: "failure", updated_at: "2026-11-04T11:00:00Z" });
  assert.equal((await lookup({ runs: [run(42), rerunFailed] })).found, null);
  assert.equal((await lookup({ runs: [run(42), run(40, { conclusion: "failure" })] })).found, "42");
  // A reuse run has no marker and does not block the full run behind it.
  assert.equal((await lookup({ runs: [run(42), run(50)] })).found, "42");
  assert.equal((await lookup({ runs: [run(42), run(99, { status: "in_progress", conclusion: null })] })).found, "42");

  for (const newer of [
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { status: "in_progress", conclusion: null },
    { pull_requests: [] },
  ]) {
    assert.equal((await lookup({ runs: [run(42), run(50, newer)] })).found, null, JSON.stringify(newer));
  }
  for (const change of [
    { conclusion: "failure" },
    { pull_requests: [] },
    { pull_requests: [{ number: 8, base: { sha: baseSha }, head: { sha: headSha } }] },
    { pull_requests: [{ number: 7, base: { sha: sha }, head: { sha: headSha } }] },
  ]) {
    assert.equal((await lookup({ runs: [run(42, change)] })).found, null, JSON.stringify(change));
  }
  assert.equal((await lookup({ runs: [run(42, { path: ".github/workflows/other.yml" })] })).found, null);
  assert.equal((await lookup({ runs: [run(50)] })).found, null);
  assert.equal((await lookup({ artifacts: [] })).found, null);
  assert.equal((await lookup({ artifacts: [marker(42, { expired: true })] })).found, null);
  assert.equal((await lookup({ artifacts: [marker(42, { workflow_run: { id: 42, head_sha: sha } })] })).found, null);
  assert.equal((await lookup({ status: 403 })).found, null);

  const neverCalled = () => {
    throw new Error("must not be called");
  };
  for (const input of [
    { mergeSha: "bad", parents: [baseSha, headSha] },
    { mergeSha: sha, parents: [sha, headSha] },
    { mergeSha: sha, parents: [baseSha, sha] },
    { mergeSha: sha, parents: [] },
  ]) {
    assert.equal(
      await findQualifiedRun({ repository: "o/r", headSha, baseSha, prNumber: "7", currentRun: "99", currentAttempt: "1", token: "t", ...input }, neverCalled),
      null,
    );
  }
});

test("the workflow only reuses title or body edits and only full runs record a candidate", () => {
  const workflow = fs.readFileSync(new URL("../workflows/stable-release.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /if: github\.event_name == 'pull_request' && github\.event\.action == 'edited' && github\.event\.changes\.base == null\n/,
  );
  const aggregate = workflow.split("\n  required-pr-checks:\n")[1].split("\n  publish:")[0];
  assert.ok(aggregate.indexOf("pr-checks.mjs aggregate") < aggregate.indexOf("qualified-${{ github.sha }}"));
  const marker = aggregate.split("pr-checks.mjs aggregate")[1];
  assert.doesNotMatch(marker, /always\(\)/);
  assert.equal(marker.match(/needs\.prepare\.outputs\.reused_run == ''/g).length, 2);
  assert.match(marker, /Upload the qualified candidate marker[^]*continue-on-error: true/);
});

test("reusable managed graph rejects every incomplete inner job and a different candidate", () => {
  const complete = () => ({
    ...Object.fromEntries(managedJobs.map((job) => [job, { result: "success" }])),
    prepare: { result: "success", outputs: { sha } },
  });
  requireManagedComplete(complete(), sha);
  assert.throws(() => requireManagedComplete(complete(), "b".repeat(40)));
  for (const job of managedJobs) {
    for (const result of ["failure", "cancelled", "skipped", "pending", "neutral", undefined]) {
      const needs = complete();
      needs[job].result = result;
      assert.throws(() => requireManagedComplete(needs, sha));
    }
    const needs = complete();
    delete needs[job];
    assert.throws(() => requireManagedComplete(needs, sha));
  }
});

test("workflow wiring preserves the aggregate, exact jobs, coverage and unprivileged candidate graph", () => {
  const workflow = fs.readFileSync(".github/workflows/stable-release.yml", "utf8");
  const triggers = workflow.split("\npermissions:")[0];
  assert.match(triggers, /pull_request:/);
  assert.doesNotMatch(triggers, /paths(?:-ignore)?:/);
  assert.doesNotMatch(workflow, /pull_request_target:|workflow_run:/);
  const aggregate = workflow.split("\n  required-pr-checks:\n")[1].split("\n  publish:")[0];
  assert.match(aggregate, /name: Required PR checks\n    if: \$\{\{ always\(\) \}\}/);
  const dependencies = aggregate.match(/needs: \[(.*)\]/)[1].split(", ");
  assert.deepEqual(dependencies.sort(), [...requiredJobs, "managed"].sort());
  assert.match(aggregate, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(workflow, /run: make test-assets/);
  assert.match(workflow, /-p nac-contracts -p nac-credential-store -p nac-managed -p nac-process/);
  assert.match(workflow, /make test-durability test-managed-load test-managed-image-contract/);
  assert.match(workflow, /NAC_E2E_BINARY=.* npm --prefix crates\/nac-server\/web run test:e2e/);
  assert.match(workflow, /runner: macos-26/);
  assert.match(workflow, /target: x86_64-unknown-linux-musl/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/managed-image.yml/);
  const managed = fs.readFileSync(".github/workflows/managed-image.yml", "utf8");
  assert.doesNotMatch(managed.split("\npermissions:")[0], /pull_request:/);
  assert.match(managed, /workflow_call:/);
  assert.match(managed, /name: Managed checks complete\n    if: \$\{\{ always\(\) \}\}/);
  assert.match(managed, /needs: \[prepare, contract, quality, build-smoke\]/);
});

test("overlapping caller runs cannot replace pending managed work and pushes have one producer", () => {
  const managed = fs.readFileSync(".github/workflows/managed-image.yml", "utf8");
  const stable = fs.readFileSync(".github/workflows/stable-release.yml", "utf8");
  const triggers = managed.split("\npermissions:")[0];
  assert.match(triggers, /workflow_call:/);
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\n  (push|pull_request):/);
  assert.match(stable.split("\npermissions:")[0], /push:\n    branches: \[main, dev\]/);
  assert.match(stable, /uses: \.\/\.github\/workflows\/managed-image.yml/);
  const group = managed.match(/group: (.*)/)[1];
  assert.equal(group, "managed-image-${{ github.run_id }}-${{ github.run_attempt }}");
  const calls = [101, 102, 103].map((id) =>
    group.replace("${{ github.run_id }}", String(id)).replace("${{ github.run_attempt }}", "1"),
  );
  assert.equal(new Set(calls).size, 3, "same-ref callers must never share a pending slot");
  assert.notEqual(
    calls[0],
    group.replace("${{ github.run_id }}", "101").replace("${{ github.run_attempt }}", "2"),
  );
});

test("review request metadata operation verifies owners and excludes the author including bot PRs", () => {
  assert.equal(
    fs.readFileSync(".github/CODEOWNERS", "utf8"),
    codeowners,
  );
  const workflow = fs.readFileSync(".github/workflows/pr-reviewers.yml", "utf8");
  assert.equal(
    workflow,
    ownerArtifacts(workflow).get(".github/workflows/pr-reviewers.yml"),
    "Reviewer metadata is stale; run make generate-codeowners",
  );
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /types: \[opened, reopened, ready_for_review\]/);
  assert.doesNotMatch(workflow, /uses: actions\/checkout|run:/);
  assert.match(workflow, /getCollaboratorPermissionLevel/);
  assert.match(workflow, /owner.id !== pr.user.id/);
});

test("owner generation refuses missing or ambiguous reviewer rosters", () => {
  const workflow = fs.readFileSync(".github/workflows/pr-reviewers.yml", "utf8");
  assert.throws(() => ownerArtifacts(""), /exactly one embedded owner roster/);
  assert.throws(() => ownerArtifacts(workflow + "\n" + workflow), /exactly one embedded owner roster/);
});

test("native macOS is candidate-bound and required even for docs-only PRs", () => {
  const workflow = fs.readFileSync(".github/workflows/stable-release.yml", "utf8");
  const native = workflow.split("\n  macos-native:\n")[1].split("\n  managed:")[0];
  assert.match(native, /needs: prepare/);
  assert.match(native, /uses: \.\/\.github\/workflows\/macos-native.yml/);
  assert.match(native, /source-sha: \$\{\{ needs.prepare.outputs.sha \}\}/);
  assert.ok(requiredJobs.includes("macos-native"));
  for (const managed of ["true", "false"]) {
    const needs = successful(managed === "true" ? "success" : "skipped");
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      needs["macos-native"].result = result;
      assert.throws(() => requireComplete(needs, managed, sha), /macos-native did not succeed/);
    }
  }
});
