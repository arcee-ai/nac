import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXPECTED_ASSETS,
  GitHubApi,
  parseRcTag,
  parseStableTag,
  prepareCandidate,
  publishCandidate,
  validateStableDispatch,
} from "./rc-release.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

class FakeApi {
  constructor({ releases = [], refs = {} } = {}) {
    this.releases = structuredClone(releases);
    this.refs = new Map(Object.entries(refs));
    this.assets = new Map();
    this.created = 0;
    this.published = 0;
  }

  async listReleases() {
    return structuredClone(this.releases);
  }

  async resolveTagOrNull(tag) {
    return this.refs.get(tag) || null;
  }

  async resolveTag(tag) {
    const sha = this.refs.get(tag);
    if (!sha) throw new Error(`missing tag ${tag}`);
    return sha;
  }

  async createRelease({ tag, sha }) {
    this.created += 1;
    const release = {
      id: 100,
      tag_name: tag,
      target_commitish: sha,
      draft: true,
      prerelease: true,
      assets: [],
    };
    this.releases.push(release);
    return structuredClone(release);
  }

  async createTagRef(tag, sha) {
    this.refs.set(tag, sha);
  }

  async getRelease(id) {
    return structuredClone(this.releases.find((release) => release.id === id));
  }

  async uploadAsset(releaseId, name, bytes) {
    const release = this.releases.find((candidate) => candidate.id === releaseId);
    const asset = { id: release.assets.length + 1, name };
    release.assets.push(asset);
    this.assets.set(asset.id, Buffer.from(bytes));
    return structuredClone(asset);
  }

  async downloadAsset(asset) {
    return Buffer.from(this.assets.get(asset.id));
  }

  async publishRelease(id) {
    this.published += 1;
    const release = this.releases.find((candidate) => candidate.id === id);
    release.draft = false;
    release.prerelease = true;
    return structuredClone(release);
  }
}

function stable(tag) {
  return { id: tag, tag_name: tag, draft: false, prerelease: false, assets: [] };
}

function rc(tag, { draft = false } = {}) {
  return { id: tag, tag_name: tag, draft, prerelease: true, assets: [] };
}

function input(overrides = {}) {
  return {
    base: "0.1.2",
    sha: SHA_B,
    runNumber: 42,
    runAttempt: 1,
    ...overrides,
  };
}

test("canonical tag parsers reject malformed prereleases and rc.0", () => {
  assert.deepEqual(parseStableTag("v0.1.2")?.base, [0, 1, 2]);
  assert.equal(parseStableTag("v0.01.2"), null);
  assert.equal(parseStableTag("v0.1.2-rc.1"), null);
  assert.equal(parseRcTag("v0.1.2-rc.0"), null);
  assert.equal(parseRcTag("v0.1.2-rc.01"), null);
  assert.equal(parseRcTag("v0.1.2-beta.1"), null);
  assert.equal(parseRcTag("v0.1.2rc1"), null);
  assert.equal(parseRcTag("v0.1.2-rc.10")?.number, 10);
});

test("prepare creates the first candidate and permits run-number gaps", async () => {
  const api = new FakeApi({ releases: [stable("v0.1.1")], refs: { "v0.1.1": SHA_A } });
  const result = await prepareCandidate(input({ runNumber: 900 }), api);
  assert.deepEqual(result, {
    run: true,
    resume: false,
    sha: SHA_B,
    base: "0.1.2",
    version: "0.1.2-rc.900",
    tag: "v0.1.2-rc.900",
  });
});

test("prepare orders RC numbers numerically and skips an unchanged SHA", async () => {
  const api = new FakeApi({
    releases: [stable("v0.1.1"), rc("v0.1.2-rc.10"), rc("v0.1.2-rc.2")],
    refs: {
      "v0.1.1": SHA_A,
      "v0.1.2-rc.2": SHA_A,
      "v0.1.2-rc.10": SHA_B,
    },
  });
  const result = await prepareCandidate(input({ runNumber: 11 }), api);
  assert.equal(result.run, false);
  assert.match(result.reason, /rc\.10 already publishes/);
});

test("prepare accepts changed source while ignoring malformed release tags", async () => {
  const api = new FakeApi({
    releases: [
      stable("v0.1.1"),
      rc("v0.1.2-rc.2"),
      rc("v0.1.2-beta.9"),
      rc("v0.1.2-rc.0"),
      rc("v0.1.2-rc.01"),
    ],
    refs: { "v0.1.1": SHA_A, "v0.1.2-rc.2": SHA_A },
  });
  const result = await prepareCandidate(input({ runNumber: 10 }), api);
  assert.equal(result.run, true);
  assert.equal(result.tag, "v0.1.2-rc.10");
});

test("prepare skips when the stable target tag exists", async () => {
  const api = new FakeApi({ releases: [stable("v0.1.1")], refs: { "v0.1.2": SHA_A } });
  const result = await prepareCandidate(input(), api);
  assert.equal(result.run, false);
  assert.match(result.reason, /already exists/);
});

test("prepare rejects a base that is not ahead of the greatest stable release", async () => {
  const api = new FakeApi({ releases: [stable("v0.1.2"), stable("v0.1.1")] });
  await assert.rejects(prepareCandidate(input(), api), /greater than latest stable 0\.1\.2/);
});

test("prepare resumes only a matching same-run draft on a rerun", async () => {
  const draft = rc("v0.1.2-rc.42", { draft: true });
  draft.target_commitish = SHA_B;
  const api = new FakeApi({ releases: [stable("v0.1.1"), draft] });
  await assert.rejects(prepareCandidate(input(), api), /only be resumed by a rerun/);
  const result = await prepareCandidate(input({ runAttempt: 2 }), api);
  assert.equal(result.run, true);
  assert.equal(result.resume, true);
});

test("prepare rejects a conflicting occupied target tag", async () => {
  const api = new FakeApi({ releases: [stable("v0.1.1")], refs: { "v0.1.2-rc.42": SHA_A } });
  await assert.rejects(prepareCandidate(input(), api), /standalone tag/);
});

test("stable dispatch rejects prereleases and resolves the exact stable tag", async () => {
  const api = new FakeApi({ releases: [stable("v0.1.2")], refs: { "v0.1.2": SHA_B } });
  assert.deepEqual(await validateStableDispatch("v0.1.2", api), {
    tag: "v0.1.2",
    version: "0.1.2",
    sha: SHA_B,
  });
  await assert.rejects(validateStableDispatch("v0.1.2-rc.1", api), /canonical stable/);
  await assert.rejects(
    validateStableDispatch("v0.1.3", new FakeApi({ releases: [rc("v0.1.3")] })),
    /published stable/,
  );
});

test("GitHub API follows paginated releases and peels annotated tags", async () => {
  const api = new GitHubApi({ repo: "owner/repo", token: "test" });
  const calls = [];
  api.request = async (_method, path) => {
    calls.push(path);
    if (String(path).includes("releases?")) {
      return {
        data: [stable("v0.1.1")],
        response: { headers: { get: () => '<https://api.github.test/page-2>; rel="next"' } },
      };
    }
    if (path === "https://api.github.test/page-2") {
      return { data: [rc("v0.1.2-rc.1")], response: { headers: { get: () => null } } };
    }
    if (String(path).includes("/git/ref/tags/")) {
      return { data: { object: { type: "tag", sha: SHA_A } }, response: {} };
    }
    if (String(path).includes(`/git/tags/${SHA_A}`)) {
      return { data: { object: { type: "commit", sha: SHA_B } }, response: {} };
    }
    throw new Error(`unexpected ${path}`);
  };
  assert.equal((await api.listReleases()).length, 2);
  assert.equal(await api.resolveTag("v0.1.2-rc.1"), SHA_B);
  assert.equal(calls.length, 4);
});

async function assetDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "nac-rc-assets-"));
  for (const name of EXPECTED_ASSETS) await writeFile(join(directory, name), `bytes:${name}`);
  return directory;
}

function publishInput(assetDir, overrides = {}) {
  return {
    sha: SHA_B,
    tag: "v0.1.2-rc.42",
    runNumber: 42,
    runAttempt: 1,
    assetDir,
    ...overrides,
  };
}

test("publication creates a draft, verifies both assets, then publishes", async () => {
  const api = new FakeApi();
  const result = await publishCandidate(publishInput(await assetDirectory()), api);
  assert.equal(result.alreadyPublished, false);
  assert.equal(api.created, 1);
  assert.equal(api.published, 1);
  assert.deepEqual(
    api.releases[0].assets.map((asset) => asset.name).sort(),
    [...EXPECTED_ASSETS].sort(),
  );
  assert.equal(api.refs.get("v0.1.2-rc.42"), SHA_B);
});

test("pre-draft artifact failure creates no tag or release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nac-rc-assets-missing-"));
  await writeFile(join(directory, EXPECTED_ASSETS[0]), "partial");
  const api = new FakeApi();
  await assert.rejects(publishCandidate(publishInput(directory), api), /artifact set must be exactly/);
  assert.equal(api.created, 0);
});

test("a partial matching draft resumes without clobbering its asset", async () => {
  const directory = await assetDirectory();
  const firstName = EXPECTED_ASSETS[0];
  const bytes = await readFile(join(directory, firstName));
  const release = rc("v0.1.2-rc.42", { draft: true });
  release.id = 7;
  release.assets = [{ id: 8, name: firstName }];
  const api = new FakeApi({ releases: [release], refs: { [release.tag_name]: SHA_B } });
  api.assets.set(8, bytes);
  await publishCandidate(publishInput(directory, { runAttempt: 2 }), api);
  assert.equal(api.created, 0);
  assert.equal(api.published, 1);
  assert.equal(api.releases[0].assets.length, 2);
});

test("a published rerun exits without modifying assets", async () => {
  const release = rc("v0.1.2-rc.42");
  release.id = 9;
  release.assets = EXPECTED_ASSETS.map((name, index) => ({ id: index + 1, name }));
  const api = new FakeApi({ releases: [release], refs: { [release.tag_name]: SHA_B } });
  const result = await publishCandidate(publishInput(await assetDirectory(), { runAttempt: 2 }), api);
  assert.equal(result.alreadyPublished, true);
  assert.equal(api.created, 0);
  assert.equal(api.published, 0);
});
