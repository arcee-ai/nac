import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { nextVersion, parseVersion, validateStable } from "./release-policy.mjs";

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
  assert.doesNotMatch(releaseWorkflow, /^\s*schedule:/m);
  assert.doesNotMatch(releaseWorkflow, /nightly|rc-release/i);
});
