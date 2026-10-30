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

test("only an equal published tag at the exact scanned SHA can resume duplicate handling", async () => {
  const published = { tagName: "v0.1.5", sha };
  const mock = manifest([candidate()], [published]);
  assert.deepEqual(await publishScannedRelease(mock, identity, mock.github), ["created"]);
  for (const patch of [
    { sha: undefined },
    { sha: "b".repeat(40) },
    { sha: "moved-tag" },
    { draft: true },
    { draft: true, sha: "b".repeat(40) },
  ]) {
    const wrong = manifest([candidate()], [{ ...published, ...patch }]);
    await assert.rejects(
      publishScannedRelease(wrong, identity, wrong.github),
      /not newer than published|unpublished draft/u,
    );
    assert.deepEqual(wrong.calls, []);
  }
  // A later release cannot block a verified label-only recovery, regardless
  // of the inventory's creation-date order.
  for (const releases of [
    [published, { tagName: "v0.1.6", sha: "b".repeat(40) }],
    [{ tagName: "v0.1.6", sha: "b".repeat(40) }, published],
  ]) {
    const newer = manifest([candidate()], releases);
    assert.deepEqual(await publishScannedRelease(newer, identity, newer.github), ["created"]);
    assert.equal(newer.calls.length, 1);
  }
});

test("unavailable published-release inventory fails before publication", async () => {
  for (const first of [{ tagName: "v0.1.4" }, { tagName: "v0.1.5", sha }]) {
    const mock = manifest([candidate()]);
    mock.github.releaseIterator = async function* () {
      yield first;
      throw new Error("release inventory unavailable");
    };
    await assert.rejects(
      publishScannedRelease(mock, identity, mock.github),
      /release inventory unavailable/u,
    );
    assert.deepEqual(mock.calls, []);
  }
});

test("duplicate recovery does not swallow unrelated errors or duplicate objects", async () => {
  const require = createRequire(import.meta.url);
  const { DuplicateReleaseError } = require("release-please/build/src/errors");
  for (const error of [
    new Error("publication API unavailable"),
    new DuplicateReleaseError(
      Object.assign(new Error("unrelated duplicate"), { status: 422 }),
      "v0.1.5",
    ),
  ]) {
    const mock = manifest([candidate()], [{ tagName: "v0.1.5", sha }]);
    mock.createReleasesForPullRequest = async () => {
      throw error;
    };
    await assert.rejects(
      publishScannedRelease(mock, identity, mock.github),
      (caught) => caught === error,
    );
    assert.deepEqual(mock.calls, []);
  }
});

test("locked Release Please preserves exact merge SHA, version, notes, and publication labels", async () => {
  const require = createRequire(import.meta.url);
  const { Manifest } = require("release-please");
  const { PullRequestBody } = require("release-please/build/src/util/pull-request-body");
  const { Version } = require("release-please/build/src/version");
  const { DuplicateReleaseError } = require("release-please/build/src/errors");
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
  let failComment = false;
  let failLabels = false;
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
      if (released.some((existing) => existing.tagName === release.tag.toString())) {
        throw new DuplicateReleaseError(
          Object.assign(new Error("release already exists"), { status: 422 }),
          release.tag.toString(),
        );
      }
      released.push({ tagName: release.tag.toString(), sha: release.sha });
      return {
        tagName: release.tag.toString(),
        url: "https://github.com/example/fixture/releases/tag/v0.1.5",
      };
    },
    async commentOnIssue(comment, number) {
      calls.push({ comment, number });
      if (failComment) throw new Error("transient comment API failure");
    },
    async removeIssueLabels(labels, number) {
      calls.push({ remove: labels, number });
      if (failLabels) throw new Error("label API unavailable");
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
  // Reproduce partial publication: the release was created, but commenting
  // failed before the pending label could change. The retry must reach the
  // pinned library's duplicate handler and repair the labels without a release.
  released.pop();
  failComment = true;
  calls.length = 0;
  await assert.rejects(
    publishScannedRelease(realManifest, identity, github),
    /transient comment API failure/u,
  );
  assert.deepEqual(released.at(-1), { tagName: "v0.1.5", sha });
  assert.ok(calls.every((call) => !call.remove && !call.add));
  failComment = false;
  calls.length = 0;
  assert.deepEqual(await publishScannedRelease(realManifest, identity, github), []);
  assert.equal(calls.filter((call) => call.release).length, 0);
  assert.equal(released.length, 2);
  assert.deepEqual(
    calls.filter((call) => call.remove || call.add),
    [
      { remove: ["autorelease: pending"], number: 42 },
      { add: ["autorelease: tagged"], number: 42 },
    ],
  );
  failLabels = true;
  calls.length = 0;
  await assert.rejects(
    publishScannedRelease(realManifest, identity, github),
    /label API unavailable/u,
  );
  assert.equal(calls.filter((call) => call.release || call.add).length, 0);
  failLabels = false;
  // A newer release shipped while the older PR remained pending. Recovery is
  // still label-only: no create API call, so Latest cannot move backward even
  // if that API would otherwise accept an older new release.
  released.push({ tagName: "v0.1.6" });
  calls.length = 0;
  assert.deepEqual(await publishScannedRelease(realManifest, identity, github), []);
  assert.equal(calls.filter((call) => call.release).length, 0);
  assert.deepEqual(
    calls.filter((call) => call.remove || call.add),
    [
      { remove: ["autorelease: pending"], number: 42 },
      { add: ["autorelease: tagged"], number: 42 },
    ],
  );
  // Without the exact existing release, this is a new older publication and
  // must fail before either creation or label changes.
  released.splice(1, 1);
  calls.length = 0;
  await assert.rejects(
    publishScannedRelease(realManifest, identity, github),
    /not newer than published v0.1.6/u,
  );
  assert.deepEqual(calls, []);
});
