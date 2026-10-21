import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  managedApplicable,
  requiredJobs,
  requireComplete,
  managedJobs,
  requireManagedComplete,
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
  assert.match(workflow, /run: make test-e2e/);
  assert.match(workflow, /runner: macos-26/);
  assert.match(workflow, /target: x86_64-unknown-linux-musl/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/managed-image.yml/);
  const managed = fs.readFileSync(".github/workflows/managed-image.yml", "utf8");
  assert.doesNotMatch(managed.split("\npermissions:")[0], /pull_request:/);
  assert.match(managed, /workflow_call:/);
  assert.match(managed, /name: Managed checks complete\n    if: \$\{\{ always\(\) \}\}/);
  assert.match(managed, /needs: \[prepare, contract, quality, build-smoke\]/);
});

test("review request metadata operation verifies owners and excludes the author including bot PRs", () => {
  assert.equal(
    fs.readFileSync(".github/CODEOWNERS", "utf8"),
    "* @allisoneer @Cecocho @ericlau98\n",
  );
  const workflow = fs.readFileSync(".github/workflows/pr-reviewers.yml", "utf8");
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /types: \[opened, reopened, ready_for_review\]/);
  assert.doesNotMatch(workflow, /uses: actions\/checkout|run:/);
  assert.match(workflow, /getCollaboratorPermissionLevel/);
  assert.match(workflow, /owner.id !== pr.user.id/);
});
