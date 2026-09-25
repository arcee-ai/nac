import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseVersion,
  validateDevAncestry,
  validatePreparationSource,
  validateStable,
} from "./release-policy.mjs";

const require = createRequire(import.meta.url);
const { Manifest } = require("release-please");
const { buildStrategy } = require("release-please/build/src/factory");
const { parseConventionalCommits } = require("release-please/build/src/commit");
const { Version } = require("release-please/build/src/version");

test("pinned Release Please parses the checked-in config and calculates versions", async () => {
  const github = {
    repository: { owner: "arcee-ai", repo: "nac", defaultBranch: "dev" },
    async getFileJson(file, branch) {
      assert.equal(branch, "dev");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    },
  };
  const manifest = await Manifest.fromManifest(github, "dev");
  const config = manifest.repositoryConfig["."];
  assert.equal(config.releaseType, "simple");
  assert.equal(config.bumpMinorPreMajor, true);
  assert.equal(manifest.releasedVersions["."].toString(), "0.1.4");
  assert.deepEqual(manifest.labels, ["autorelease: pending"]);
  assert.notEqual(manifest.skipLabeling, true);
  const strategy = await buildStrategy({ github, path: ".", targetBranch: "dev", ...config });

  const next = async (current, messages) => {
    const commits = parseConventionalCommits(
      messages.map((message, index) => ({ sha: String(index + 1), message })),
    );
    return (await strategy.versioningStrategy.bump(Version.parse(current), commits)).toString();
  };
  assert.equal(await next("0.1.4", ["fix(store): preserve rows"]), "0.1.5");
  assert.equal(await next("0.1.4", ["feat: add status"]), "0.2.0");
  assert.equal(await next("0.1.4", ["feat!: replace wire shape"]), "0.2.0");
  assert.equal(
    await next("0.1.4", ["fix: change\n\nBREAKING CHANGE: incompatible"]),
    "0.2.0",
  );
  assert.equal(await next("1.2.3", ["feat!: replace wire shape"]), "2.0.0");
});

test("stable validation binds the canonical tag to root product identity", () => {
  validateStable("v0.1.4", "0.1.4\n");
  assert.throws(() => validateStable("v0.1.5", "0.1.4"), /does not match/);
  assert.throws(() => parseVersion("0.1.4-rc.1"), /stable semantic version/);
});

test("stable source validation rejects a same-version commit outside dev", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-release-policy-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.name", "Release Policy Test");
    git("config", "user.email", "release-policy@example.invalid");
    fs.writeFileSync(path.join(root, "version.txt"), "0.1.4\n");
    git("add", "version.txt");
    git("commit", "--quiet", "-m", "bootstrap");
    const base = git("rev-parse", "HEAD");

    git("checkout", "--quiet", "-b", "dev");
    fs.writeFileSync(path.join(root, "dev-marker"), "accepted\n");
    git("add", "dev-marker");
    git("commit", "--quiet", "-m", "dev release source");
    const devCommit = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/dev", devCommit);

    git("checkout", "--quiet", "-b", "off-dev", base);
    fs.writeFileSync(path.join(root, "off-dev-marker"), "same version, wrong history\n");
    git("add", "off-dev-marker");
    git("commit", "--quiet", "-m", "off dev release source");
    const offDevCommit = git("rev-parse", "HEAD");

    validateStable("v0.1.4", fs.readFileSync(path.join(root, "version.txt"), "utf8"));
    validateDevAncestry(devCommit, "refs/remotes/origin/dev", root);
    assert.throws(
      () => validateDevAncestry(offDevCommit, "refs/remotes/origin/dev", root),
      /not an ancestor/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stable preparation requires the explicitly selected current dev commit", () => {
  const selected = "a".repeat(40);
  const valid = {
    eventName: "workflow_dispatch",
    eventRef: "refs/heads/dev",
    eventSha: selected,
    requestedSha: selected.toUpperCase(),
    devSha: selected,
  };
  validatePreparationSource(valid);
  assert.throws(
    () => validatePreparationSource({ ...valid, eventName: "push" }),
    /requires workflow_dispatch/,
  );
  assert.throws(
    () => validatePreparationSource({ ...valid, eventRef: "refs/heads/topic" }),
    /dispatched against dev/,
  );
  assert.throws(
    () => validatePreparationSource({ ...valid, requestedSha: "a".repeat(12) }),
    /full requested dev SHA/,
  );
  assert.throws(
    () => validatePreparationSource({ ...valid, requestedSha: "b".repeat(40) }),
    /does not match dispatched source/,
  );
  assert.throws(
    () => validatePreparationSource({ ...valid, devSha: "b".repeat(40) }),
    /not the current dev tip/,
  );
});

test("release please is explicitly a dev-targeted root simple release", () => {
  const config = JSON.parse(fs.readFileSync("release-please-config.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync(".release-please-manifest.json", "utf8"));
  const workflow = fs.readFileSync(".github/workflows/release-please.yml", "utf8");
  const stableWorkflow = fs.readFileSync(".github/workflows/stable-release.yml", "utf8");
  const managedWorkflow = fs.readFileSync(".github/workflows/managed-image.yml", "utf8");
  const rollout = fs.readFileSync(".github/scripts/stable-release-rollout.sh", "utf8");
  const releasePleaseTriggers = workflow.slice(
    workflow.indexOf("on:\n"),
    workflow.indexOf("\npermissions:"),
  );
  const preparationJob = workflow.slice(
    workflow.indexOf("  prepare-release-pr:"),
    workflow.indexOf("  publish-approved-release:"),
  );
  const publicationJob = workflow.slice(workflow.indexOf("  publish-approved-release:"));

  assert.equal(config["release-type"], "simple");
  assert.equal(config["bump-minor-pre-major"], true);
  assert.deepEqual(Object.keys(config.packages), ["."]);
  assert.equal(JSON.stringify(config).includes("extra-files"), false);
  assert.equal(manifest["."], fs.readFileSync("version.txt", "utf8").trim());
  assert.match(releasePleaseTriggers, /^on:\n  workflow_dispatch:/);
  assert.match(releasePleaseTriggers, /dev_sha:[\s\S]*required: true/);
  assert.match(releasePleaseTriggers, /pull_request:\n    branches: \[dev\]\n    types: \[closed\]/);
  assert.doesNotMatch(releasePleaseTriggers, /^\s*push:/m);
  assert.match(workflow, /target-branch: dev/);
  assert.match(preparationJob, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(preparationJob, /release-policy\.mjs validate-prepare/);
  assert.ok(
    preparationJob.indexOf("validate-prepare") <
      preparationJob.indexOf("Mint repository-scoped release token"),
  );
  assert.match(preparationJob, /stable-release-preparation\.sh stage/);
  assert.match(preparationJob, /target-branch: release-preparation-source/);
  assert.match(preparationJob, /stable-release-preparation\.sh finalize/);
  assert.ok(
    preparationJob.indexOf("stable-release-preparation.sh stage") <
      preparationJob.indexOf("target-branch: release-preparation-source") &&
      preparationJob.indexOf("target-branch: release-preparation-source") <
        preparationJob.indexOf("stable-release-preparation.sh finalize"),
  );
  assert.match(preparationJob, /skip-github-release: true/);
  assert.doesNotMatch(preparationJob, /skip-github-pull-request/);
  assert.match(publicationJob, /github\.event\.pull_request\.merged == true/);
  assert.match(publicationJob, /head\.repo\.full_name == github\.repository/);
  assert.match(
    publicationJob,
    /release-please--branches--release-preparation-source--components--nac/,
  );
  assert.match(publicationJob, /target-branch: dev/);
  assert.match(publicationJob, /skip-github-pull-request: true/);
  assert.doesNotMatch(publicationJob, /skip-github-release/);
  assert.equal(workflow.match(/googleapis\/release-please-action@v4/g)?.length, 2);
  assert.match(workflow, /create-github-app-token@v2/);
  assert.match(workflow, /repositories: nac/);
  assert.match(workflow, /permission-contents: write/);
  assert.match(workflow, /permission-pull-requests: write/);
  assert.match(workflow, /permission-issues: write/);
  assert.doesNotMatch(workflow, /skip-labeling/);
  assert.doesNotMatch(workflow, /secrets\.(?:PAT|AWS[^ }]*|GITHUB_TOKEN)/i);
  assert.equal(fs.existsSync(".github/workflows/release.yml"), false);
  assert.match(stableWorkflow, /branches: \[main, dev\]/);
  assert.match(stableWorkflow, /tags: \["v\*\.\*\.\*"\]/);
  assert.match(
    stableWorkflow,
    /git fetch --no-tags origin dev:refs\/remotes\/origin\/dev/,
  );
  assert.match(stableWorkflow, /DEV_REF=refs\/remotes\/origin\/dev/);
  assert.match(stableWorkflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(stableWorkflow, /^\s*release:/m);
  assert.doesNotMatch(stableWorkflow, /^\s*schedule:/m);
  assert.doesNotMatch(stableWorkflow, /nightly|rc-release|event\.release|inputs\.release_tag/i);
  assert.equal(managedWorkflow.match(/- version\.txt/g)?.length, 2);

  const verifyNewLane = rollout.indexOf("contents/.github/workflows/stable-release.yml?ref=dev");
  const verifyRegistration = rollout.indexOf("actions/workflows/stable-release.yml");
  const verifyActive = rollout.indexOf('stable_state" != "active"');
  const disableLegacy = rollout.indexOf("actions/workflows/$legacy_id/disable");
  assert.ok(
    verifyNewLane >= 0 &&
      verifyRegistration > verifyNewLane &&
      verifyActive > verifyRegistration &&
      disableLegacy > verifyActive,
  );
  assert.match(rollout, /actions\/workflows\/release\.yml/);
  assert.match(rollout, /disabled_manually/);
});

test("stable preparation pins Release Please to one source before targeting dev", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-stable-preparation-"));
  const fakeGh = path.join(root, "gh");
  const sourceRef = path.join(root, "source-ref");
  const prBase = path.join(root, "pr-base");
  const selected = "a".repeat(40);
  fs.writeFileSync(
    fakeGh,
    `#!/bin/sh
set -eu
case "$*" in
  "api repos/test/repo/git/ref/heads/dev --jq .object.sha")
    if [ "\${ADVANCE_AFTER_RETARGET:-no}" = yes ] && [ "$(cat "$PR_BASE" 2>/dev/null || true)" = dev ]; then
      printf '%s\\n' "$(printf 'b%.0s' $(seq 1 40))"
    else
      printf '%s\\n' "$SOURCE_SHA"
    fi
    ;;
  "api repos/test/repo/git/ref/heads/release-preparation-source --silent")
    test -f "$SOURCE_REF"
    ;;
  api\\ --method\\ PATCH\\ repos/test/repo/git/refs/heads/release-preparation-source*)
    printf '%s\\n' "$SOURCE_SHA" > "$SOURCE_REF"
    ;;
  api\\ --method\\ POST\\ repos/test/repo/git/refs*)
    printf '%s\\n' "$SOURCE_SHA" > "$SOURCE_REF"
    ;;
  "api repos/test/repo/git/ref/heads/release-preparation-source --jq .object.sha")
    cat "$SOURCE_REF"
    ;;
  *"repos/test/repo/pulls -f state=open"*"--jq length")
    if [ -f "$PR_BASE" ]; then echo 1; else echo 0; fi
    ;;
  *"repos/test/repo/pulls -f state=open"*"--jq .[0].number // empty")
    echo 17
    ;;
  *"repos/test/repo/pulls -f state=open"*"--jq .[0].base.ref // empty")
    cat "$PR_BASE"
    ;;
  "api --paginate repos/test/repo/pulls/17/files --jq .[].filename")
    printf '%s\\n' .release-please-manifest.json CHANGELOG.md version.txt
    ;;
  "api --method PATCH repos/test/repo/pulls/17 -f base=dev --silent")
    echo dev > "$PR_BASE"
    ;;
  "api --method PATCH repos/test/repo/pulls/17 -f base=release-preparation-source --silent")
    echo release-preparation-source > "$PR_BASE"
    ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`,
  );
  fs.chmodSync(fakeGh, 0o755);
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    GH_TOKEN: "test-token",
    GITHUB_REPOSITORY: "test/repo",
    GITHUB_REPOSITORY_OWNER: "test",
    SOURCE_SHA: selected.toUpperCase(),
    SOURCE_REF: sourceRef,
    PR_BASE: prBase,
  };
  const script = ".github/scripts/stable-release-preparation.sh";
  try {
    const staged = spawnSync(script, ["stage"], { encoding: "utf8", env });
    assert.equal(staged.status, 0, staged.stderr);
    assert.equal(fs.readFileSync(sourceRef, "utf8").trim(), selected);

    fs.writeFileSync(prBase, "release-preparation-source\n");
    const finalized = spawnSync(script, ["finalize"], { encoding: "utf8", env });
    assert.equal(finalized.status, 0, finalized.stderr);
    assert.match(finalized.stdout, /pull\/17.*aaaaaaaa/);
    assert.equal(fs.readFileSync(prBase, "utf8").trim(), "dev");

    const restaged = spawnSync(script, ["stage"], { encoding: "utf8", env });
    assert.equal(restaged.status, 0, restaged.stderr);
    assert.equal(fs.readFileSync(prBase, "utf8").trim(), "release-preparation-source");

    const stale = spawnSync(script, ["finalize"], {
      encoding: "utf8",
      env: { ...env, ADVANCE_AFTER_RETARGET: "yes" },
    });
    assert.equal(stale.status, 1, stale.stderr);
    assert.match(stale.stderr, /dev changed while finalizing/);
    assert.equal(fs.readFileSync(prBase, "utf8").trim(), "release-preparation-source");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stable rollout verifies the distinct dev workflow before disabling legacy publication", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-stable-rollout-"));
  const fakeGh = path.join(root, "gh");
  const log = path.join(root, "calls.log");
  const state = path.join(root, "disabled");
  fs.writeFileSync(
    fakeGh,
    `#!/bin/sh
set -eu
echo "$*" >> "$ROLLOUT_LOG"
case "$*" in
  *"contents/.github/workflows/stable-release.yml?ref=dev --jq .path"*)
    if [ "\${STABLE_CONTENTS:-yes}" != yes ]; then exit 4; fi
    echo .github/workflows/stable-release.yml
    ;;
  *"actions/workflows/stable-release.yml --jq .id"*)
    if [ "\${STABLE_REGISTERED:-yes}" != yes ]; then exit 5; fi
    echo 84
    ;;
  *"actions/workflows/84 --jq .path"*)
    echo .github/workflows/stable-release.yml
    ;;
  *"actions/workflows/84 --jq .state"*)
    echo "\${STABLE_STATE:-active}"
    ;;
  *"actions/workflows/release.yml --jq .id"*)
    echo 42
    ;;
  *"--method PUT repos/test/repo/actions/workflows/42/disable"*)
    : > "$ROLLOUT_STATE"
    ;;
  *"actions/workflows/42 --jq .state"*)
    if [ -f "$ROLLOUT_STATE" ]; then echo disabled_manually; else echo active; fi
    ;;
  *) exit 9 ;;
esac
`,
  );
  fs.chmodSync(fakeGh, 0o755);
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    ROLLOUT_LOG: log,
    ROLLOUT_STATE: state,
  };
  try {
    const check = spawnSync(
      ".github/scripts/stable-release-rollout.sh",
      ["--check", "test/repo"],
      { encoding: "utf8", env },
    );
    assert.equal(check.status, 1);
    assert.match(check.stderr, /rerun with --apply/);
    assert.doesNotMatch(fs.readFileSync(log, "utf8"), /--method PUT/);

    const apply = spawnSync(
      ".github/scripts/stable-release-rollout.sh",
      ["--apply", "test/repo"],
      { encoding: "utf8", env },
    );
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /registered and active.*legacy release.yml is disabled/);
    const calls = fs.readFileSync(log, "utf8");
    assert.ok(
      calls.indexOf("contents/.github/workflows/stable-release.yml?ref=dev") <
        calls.indexOf("--method PUT"),
      calls,
    );

    for (const override of [
      { STABLE_CONTENTS: "no" },
      { STABLE_REGISTERED: "no" },
      { STABLE_STATE: "disabled_manually" },
    ]) {
      fs.writeFileSync(log, "");
      const rejected = spawnSync(
        ".github/scripts/stable-release-rollout.sh",
        ["--apply", "test/repo"],
        { encoding: "utf8", env: { ...env, ...override } },
      );
      assert.notEqual(rejected.status, 0, JSON.stringify(override));
      assert.doesNotMatch(fs.readFileSync(log, "utf8"), /--method PUT/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("public protocol identity never uses internal crate versions", () => {
  const surfaces = [
    "crates/nac-core/src/mcp/registry.rs",
    "crates/nac-core/src/model/client/mod.rs",
    "crates/nac-core/src/model/arcee.rs",
    "crates/nac-core/src/model/chatgpt_codex.rs",
    "crates/nac-managed/src/github.rs",
    "crates/nac-server/src/mcp.rs",
  ];
  for (const surface of surfaces) {
    const source = fs.readFileSync(surface, "utf8");
    assert.doesNotMatch(source, /CARGO_PKG_VERSION/, surface);
    assert.match(source, /PRODUCT_VERSION|product_user_agent_for_version/, surface);
  }
});
