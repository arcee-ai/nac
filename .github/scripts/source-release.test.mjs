import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { publishScannedRelease } from "./source-release.mjs";

const sha = "a".repeat(40);
const identity = { sha, prNumber: 42, version: "0.1.5" };
const candidate = () => ({
  sha,
  pullRequest: { sha, number: 42 },
  path: ".",
  tag: { toString: () => "v0.1.5" },
});
function manifest(candidates, published = []) {
  const calls = [];
  return {
    calls,
    github: {
      async *releaseIterator() {
        yield* published;
      },
    },
    async buildReleases() {
      return candidates;
    },
    async createReleasesForPullRequest(releases, pr) {
      calls.push({ releases, pr });
      return ["created"];
    },
  };
}

test("only the exact scanned release plan is published without a second mutable discovery", async () => {
  const release = candidate();
  const mock = manifest([release]);
  assert.deepEqual(await publishScannedRelease(mock, identity, mock.github), ["created"]);
  assert.deepEqual(mock.calls, [{ releases: [release], pr: release.pullRequest }]);
});

test("an older blocked pending release does not prevent publishing the separately scanned PR", async () => {
  const release = candidate();
  const older = {
    ...candidate(),
    sha: "b".repeat(40),
    pullRequest: { sha: "b".repeat(40), number: 41 },
    tag: { toString: () => "v0.1.4" },
  };
  const mock = manifest([older, release]);
  assert.deepEqual(await publishScannedRelease(mock, identity, mock.github), ["created"]);
  assert.deepEqual(mock.calls, [{ releases: [release], pr: release.pullRequest }]);
});

test("unscanned, missing, multiple, wrong-PR/version/path and force-tag releases fail before side effects", async () => {
  for (const candidates of [
    [],
    [candidate(), candidate()],
    [{ ...candidate(), sha: "b".repeat(40) }],
    [{ ...candidate(), pullRequest: { sha: "b".repeat(40), number: 42 } }],
    [{ ...candidate(), pullRequest: { sha, number: 43 } }],
    [{ ...candidate(), tag: { toString: () => "v0.1.6" } }],
    [{ ...candidate(), path: "other" }],
    [{ ...candidate(), forceTag: true }],
  ]) {
    const mock = manifest(candidates);
    await assert.rejects(publishScannedRelease(mock, identity, mock.github));
    assert.deepEqual(mock.calls, []);
  }
});

test("malformed source identities cannot publish", async () => {
  for (const patch of [
    { sha: "dev" },
    { sha: "" },
    { prNumber: 0 },
    { prNumber: NaN },
    { version: "0.1.5-rc.1" },
    { version: "latest" },
  ]) {
    const mock = manifest([candidate()]);
    await assert.rejects(publishScannedRelease(mock, { ...identity, ...patch }, mock.github));
    assert.deepEqual(mock.calls, []);
  }
});

test("recovery refuses equal or newer published stable versions without publishing or changing labels", async () => {
  for (const tagName of ["v0.1.5", "v0.1.6", "v0.2.0", "v1.0.0", "v0.1.10"]) {
    const mock = manifest([candidate()], [{ tagName: "v0.1.4" }, { tagName }]);
    await assert.rejects(
      publishScannedRelease(mock, identity, mock.github),
      /not newer than published/u,
    );
    assert.deepEqual(mock.calls, []);
  }
});

test("numeric release order permits a newer stable plan and ignores drafts and prereleases", async () => {
  const mock = manifest(
    [candidate()],
    [
      { tagName: "v0.1.4" },
      { tagName: "v0.0.99" },
      { tagName: "v0.2.0", draft: true },
      { tagName: "v9.0.0-rc.1" },
    ],
  );
  assert.deepEqual(await publishScannedRelease(mock, identity, mock.github), ["created"]);
  assert.equal(mock.calls.length, 1);
});

test("unavailable published-release inventory fails before publication", async () => {
  const mock = manifest([candidate()]);
  mock.github.releaseIterator = async function* () {
    yield { tagName: "v0.1.4" };
    throw new Error("release inventory unavailable");
  };
  await assert.rejects(
    publishScannedRelease(mock, identity, mock.github),
    /release inventory unavailable/u,
  );
  assert.deepEqual(mock.calls, []);
});

test("locked Release Please preserves exact merge SHA, version, notes, and publication labels", async () => {
  const require = createRequire(import.meta.url);
  const { Manifest } = require("release-please");
  const { PullRequestBody } = require("release-please/build/src/util/pull-request-body");
  const { Version } = require("release-please/build/src/version");
  const notes =
    "## [0.1.5](https://github.com/example/fixture/compare/v0.1.4...v0.1.5)\n\nReviewed release notes";
  const pr = {
    sha,
    number: 42,
    title: "chore(dev): release 0.1.5",
    headBranchName: "release-please--branches--release-preparation-source--components--nac",
    body: new PullRequestBody([
      { component: "nac", version: Version.parse("0.1.5"), notes },
    ]).toString(),
    labels: ["autorelease: pending"],
    files: [],
  };
  const calls = [];
  const released = [{ tagName: "v0.1.4" }];
  const github = {
    repository: { owner: "arcee-ai", repo: "nac", defaultBranch: "dev" },
    async getFileJson(file, branch) {
      assert.equal(branch, "dev");
      return JSON.parse(readFileSync(file, "utf8"));
    },
    async *releaseIterator() {
      yield* released;
    },
    async *pullRequestIterator(branch, state) {
      assert.equal(branch, "dev");
      assert.equal(state, "MERGED");
      yield { ...pr, sha: "b".repeat(40), number: 41, title: "chore(dev): release 0.1.4" };
      yield pr;
    },
    async createRelease(release, options) {
      calls.push({ release, options });
      return {
        tagName: release.tag.toString(),
        url: "https://github.com/example/fixture/releases/tag/v0.1.5",
      };
    },
    async commentOnIssue(comment, number) {
      calls.push({ comment, number });
    },
    async removeIssueLabels(labels, number) {
      calls.push({ remove: labels, number });
    },
    async addIssueLabels(labels, number) {
      calls.push({ add: labels, number });
    },
  };
  const realManifest = await Manifest.fromManifest(github, "dev");
  const published = await publishScannedRelease(realManifest, identity, github);
  assert.equal(published[0].version, "0.1.5");
  assert.equal(published[0].prNumber, 42);
  assert.equal(calls[0].release.sha, sha);
  assert.equal(calls[0].release.tag.toString(), "v0.1.5");
  assert.equal(calls[0].release.notes, notes);
  assert.deepEqual(
    calls.find((call) => call.remove),
    { remove: ["autorelease: pending"], number: 42 },
  );
  assert.deepEqual(
    calls.find((call) => call.add),
    { add: ["autorelease: tagged"], number: 42 },
  );
  assert.equal(calls.filter((call) => call.release).length, 1);
  assert.ok(calls.filter((call) => call.remove || call.add).every((call) => call.number === 42));
  // A newer release shipped while this older PR remained pending. Its recovery
  // must not call Release Please's publishing or label-changing operations.
  released.push({ tagName: "v0.1.6" });
  calls.length = 0;
  await assert.rejects(
    publishScannedRelease(realManifest, identity, github),
    /not newer than published v0.1.6/u,
  );
  assert.deepEqual(calls, []);
});
