import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  nextVersion,
  parseVersion,
  validateDevAncestry,
  validateStable,
} from "./release-policy.mjs";

test("pre-1.0 release calculation matches the accepted conventional commit policy", () => {
  assert.equal(nextVersion("0.1.4", ["fix(store): preserve rows"]), "0.1.5");
  assert.equal(nextVersion("0.1.4", ["feat: add status"]), "0.2.0");
  assert.equal(nextVersion("0.1.4", ["feat!: replace wire shape"]), "0.2.0");
  assert.equal(nextVersion("0.1.4", ["fix: change\n\nBREAKING CHANGE: incompatible"]), "0.2.0");
  assert.equal(nextVersion("1.2.3", ["feat!: replace wire shape"]), "2.0.0");
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

test("release please is explicitly a dev-targeted root simple release", () => {
  const config = JSON.parse(fs.readFileSync("release-please-config.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync(".release-please-manifest.json", "utf8"));
  const workflow = fs.readFileSync(".github/workflows/release-please.yml", "utf8");
  const releaseWorkflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

  assert.equal(config["release-type"], "simple");
  assert.equal(config["bump-minor-pre-major"], true);
  assert.deepEqual(Object.keys(config.packages), ["."]);
  assert.equal(JSON.stringify(config).includes("extra-files"), false);
  assert.equal(manifest["."], fs.readFileSync("version.txt", "utf8").trim());
  assert.match(workflow, /target-branch: dev/);
  assert.match(workflow, /create-github-app-token@v2/);
  assert.match(workflow, /repositories: nac/);
  assert.doesNotMatch(workflow, /secrets\.(?:PAT|AWS[^ }]*|GITHUB_TOKEN)/i);
  assert.match(releaseWorkflow, /branches: \[main, dev\]/);
  assert.match(releaseWorkflow, /tags: \["v\*\.\*\.\*"\]/);
  assert.match(
    releaseWorkflow,
    /git fetch --no-tags origin dev:refs\/remotes\/origin\/dev/,
  );
  assert.match(releaseWorkflow, /DEV_REF=refs\/remotes\/origin\/dev/);
  assert.match(releaseWorkflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(releaseWorkflow, /^\s*release:/m);
  assert.doesNotMatch(releaseWorkflow, /^\s*schedule:/m);
  assert.doesNotMatch(releaseWorkflow, /nightly|rc-release|event\.release|inputs\.release_tag/i);
});
