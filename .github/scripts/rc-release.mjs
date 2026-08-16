#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import process from "node:process";

const STABLE_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RC_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/;
const FULL_SHA_RE = /^[0-9a-f]{40}$/i;
export const EXPECTED_ASSETS = [
  "nac-aarch64-apple-darwin.tar.gz",
  "nac-x86_64-unknown-linux-musl.tar.gz",
];

function numeric(parts) {
  const values = parts.map(Number);
  if (values.some((value) => !Number.isSafeInteger(value))) {
    return null;
  }
  return values;
}

export function parseStableTag(tag) {
  const match = STABLE_RE.exec(tag);
  if (!match) return null;
  const parts = numeric(match.slice(1));
  return parts && { tag, base: parts, baseText: parts.join(".") };
}

export function parseRcTag(tag) {
  const match = RC_RE.exec(tag);
  if (!match) return null;
  const values = numeric(match.slice(1));
  if (!values || values[3] === 0) return null;
  return {
    tag,
    base: values.slice(0, 3),
    baseText: values.slice(0, 3).join("."),
    number: values[3],
  };
}

function compareParts(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function greatestStableRelease(releases) {
  const stableVersions = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => parseStableTag(release.tag_name))
    .filter(Boolean);
  stableVersions.sort((left, right) => compareParts(right.base, left.base));
  return stableVersions[0] || null;
}

function requireSha(sha, context) {
  if (!FULL_SHA_RE.test(sha)) throw new Error(`${context} did not resolve to a full commit SHA`);
  return sha.toLowerCase();
}

function releaseForTag(releases, tag) {
  return releases.find((release) => release.tag_name === tag);
}

export async function prepareCandidate(input, api) {
  const sha = requireSha(input.sha, "scheduled source");
  const runNumber = Number(input.runNumber);
  const runAttempt = Number(input.runAttempt);
  if (!Number.isSafeInteger(runNumber) || runNumber <= 0) {
    throw new Error(`invalid github.run_number ${input.runNumber}`);
  }
  if (!Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
    throw new Error(`invalid github.run_attempt ${input.runAttempt}`);
  }

  const releases = await api.listReleases();
  const latestStable = greatestStableRelease(releases);
  if (!latestStable) throw new Error("nightly RCs require a published stable release");

  const latestStableSha = await api.resolveTag(latestStable.tag);
  if (latestStableSha === sha) {
    return { run: false, reason: `${latestStable.tag} already publishes ${sha}` };
  }
  const comparison = await api.compareCommits(latestStableSha, sha);
  if (comparison !== "ahead") {
    throw new Error(
      `scheduled source is ${comparison} relative to latest stable ${latestStable.tag}`,
    );
  }

  const baseParts = [...latestStable.base];
  baseParts[2] += 1;
  if (!Number.isSafeInteger(baseParts[2])) {
    throw new Error(`cannot increment patch version for ${latestStable.tag}`);
  }
  const base = baseParts.join(".");
  const stableTag = `v${base}`;
  if (await api.resolveTagOrNull(stableTag)) {
    return { run: false, reason: `${stableTag} already exists` };
  }

  const currentTrain = releases
    .filter((release) => !release.draft && release.prerelease)
    .map((release) => ({ release, parsed: parseRcTag(release.tag_name) }))
    .filter(({ parsed }) => parsed?.baseText === base)
    .sort((left, right) => right.parsed.number - left.parsed.number);
  if (currentTrain[0]) {
    const previousSha = await api.resolveTag(currentTrain[0].release.tag_name);
    if (previousSha === sha) {
      return {
        run: false,
        reason: `${currentTrain[0].release.tag_name} already publishes ${sha}`,
      };
    }
  }

  const tag = `${stableTag}-rc.${runNumber}`;
  const version = `${base}-rc.${runNumber}`;
  const existingRelease = releaseForTag(releases, tag);
  const tagSha = await api.resolveTagOrNull(tag);

  if (existingRelease && !existingRelease.draft) {
    if (!existingRelease.prerelease || tagSha !== sha) {
      throw new Error(`${tag} is already published with conflicting identity`);
    }
    return { run: false, alreadyPublished: true, reason: `${tag} is already published` };
  }

  if (existingRelease?.draft) {
    if (runAttempt <= 1) throw new Error(`${tag} draft may only be resumed by a rerun`);
    const matchingSource =
      tagSha === sha || (!tagSha && existingRelease.target_commitish === sha);
    if (!existingRelease.prerelease || !matchingSource) {
      throw new Error(`${tag} draft does not match the scheduled candidate`);
    }
    return {
      run: true,
      resume: true,
      sha,
      base,
      version,
      tag,
      latestStableTag: latestStable.tag,
      latestStableSha,
    };
  }

  if (tagSha) {
    // A read-only workflow token cannot see draft releases. On a rerun, defer
    // the draft-versus-standalone decision to the write-scoped publish job,
    // which revalidates both the release and the tag before modifying either.
    if (runAttempt > 1 && tagSha === sha) {
      return {
        run: true,
        resume: true,
        sha,
        base,
        version,
        tag,
        latestStableTag: latestStable.tag,
        latestStableSha,
      };
    }
    throw new Error(`${tag} is occupied by a standalone tag`);
  }
  return {
    run: true,
    resume: false,
    sha,
    base,
    version,
    tag,
    latestStableTag: latestStable.tag,
    latestStableSha,
  };
}

export async function validateStableDispatch(tag, api) {
  const parsed = parseStableTag(tag);
  if (!parsed) throw new Error(`manual release_tag must be canonical stable vX.Y.Z, got ${tag}`);
  const release = releaseForTag(await api.listReleases(), tag);
  if (!release || release.draft || release.prerelease) {
    throw new Error(`${tag} must name an existing published stable GitHub Release`);
  }
  return { tag, version: parsed.baseText, sha: await api.resolveTag(tag) };
}

function linkNext(value) {
  if (!value) return null;
  for (const entry of value.split(",")) {
    const match = /<([^>]+)>;\s*rel="([^"]+)"/.exec(entry.trim());
    if (match && match[2].split(/\s+/).includes("next")) return match[1];
  }
  return null;
}

class HttpError extends Error {
  constructor(method, url, status, body) {
    super(`${method} ${url} failed: HTTP ${status}: ${body.slice(0, 500)}`);
    this.status = status;
  }
}

export class GitHubApi {
  constructor({ repo, token, apiBase = "https://api.github.com", uploadsBase } = {}) {
    this.repo = repo;
    this.token = token;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.uploadsBase = (uploadsBase || apiBase.replace("api.github.com", "uploads.github.com")).replace(
      /\/$/,
      "",
    );
  }

  async request(
    method,
    path,
    { body, accept = "application/vnd.github+json", raw = false } = {},
  ) {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path}`;
    const headers = {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "nac-nightly-release",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new HttpError(method, url, response.status, await response.text());
    }
    return {
      response,
      data: response.status === 204 || raw ? null : await response.json(),
    };
  }

  async listReleases() {
    const releases = [];
    let next = `${this.apiBase}/repos/${this.repo}/releases?per_page=100&page=1`;
    while (next) {
      const { response, data } = await this.request("GET", next);
      if (!Array.isArray(data)) throw new Error("GitHub releases response was not an array");
      releases.push(...data);
      next = linkNext(response.headers.get("link"));
    }
    return releases;
  }

  async compareCommits(base, head) {
    const { data } = await this.request(
      "GET",
      `/repos/${this.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
    if (!["ahead", "behind", "diverged", "identical"].includes(data?.status)) {
      throw new Error("GitHub compare response had an invalid status");
    }
    return data.status;
  }

  async resolveTagOrNull(tag) {
    try {
      return await this.resolveTag(tag);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  async resolveTag(tag) {
    let object = (
      await this.request(
        "GET",
        `/repos/${this.repo}/git/ref/tags/${encodeURIComponent(tag)}`,
      )
    ).data.object;
    const seen = new Set();
    for (let depth = 0; depth < 16; depth += 1) {
      if (!object || String(object.sha) !== object.sha) throw new Error(`${tag} has an invalid Git ref`);
      if (object.type === "commit") return requireSha(object.sha, tag);
      if (object.type !== "tag") throw new Error(`${tag} points to unsupported ${object.type || "object"}`);
      if (seen.has(object.sha)) throw new Error(`${tag} contains an annotated-tag cycle`);
      seen.add(object.sha);
      object = (await this.request("GET", `/repos/${this.repo}/git/tags/${object.sha}`)).data.object;
    }
    throw new Error(`${tag} annotated-tag chain is too deep`);
  }

  async createRelease({ tag, sha }) {
    return (
      await this.request("POST", `/repos/${this.repo}/releases`, {
        body: {
          tag_name: tag,
          target_commitish: sha,
          name: tag,
          body: `Automated nightly release candidate for ${sha}.`,
          draft: true,
          prerelease: true,
          make_latest: "false",
        },
      })
    ).data;
  }

  async createTagRef(tag, sha) {
    return (
      await this.request("POST", `/repos/${this.repo}/git/refs`, {
        body: { ref: `refs/tags/${tag}`, sha },
      })
    ).data;
  }

  async getRelease(id) {
    return (await this.request("GET", `/repos/${this.repo}/releases/${id}`)).data;
  }

  async uploadAsset(releaseId, name, bytes) {
    const url = `${this.uploadsBase}/repos/${this.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/gzip",
        "User-Agent": "nac-nightly-release",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: bytes,
    });
    if (!response.ok) throw new HttpError("POST", url, response.status, await response.text());
    return response.json();
  }

  async downloadAsset(asset) {
    const { response } = await this.request(
      "GET",
      `/repos/${this.repo}/releases/assets/${asset.id}`,
      { accept: "application/octet-stream", raw: true },
    );
    return Buffer.from(await response.arrayBuffer());
  }

  async publishRelease(id) {
    return (
      await this.request("PATCH", `/repos/${this.repo}/releases/${id}`, {
        body: { draft: false, prerelease: true, make_latest: "false" },
      })
    ).data;
  }
}

function sameBytes(left, right) {
  return left.equals(right);
}

async function requireLatestStableSnapshot(input, api, releases) {
  const expected = parseStableTag(input.latestStableTag);
  if (!expected) throw new Error("nightly candidate is missing its latest stable tag");
  const expectedSha = requireSha(input.latestStableSha, expected.tag);
  const latest = greatestStableRelease(releases);
  if (!latest || latest.tag !== expected.tag) {
    throw new Error(`latest stable changed after candidate preparation; expected ${expected.tag}`);
  }
  if ((await api.resolveTag(expected.tag)) !== expectedSha) {
    throw new Error(`${expected.tag} moved after candidate preparation`);
  }
}

export async function publishCandidate(input, api) {
  const sha = requireSha(input.sha, "candidate");
  const parsed = parseRcTag(input.tag);
  if (!parsed || parsed.number !== Number(input.runNumber)) {
    throw new Error("candidate tag does not match the workflow run number");
  }
  const base = parsed.baseText;

  const names = (await readdir(input.assetDir)).sort();
  if (names.join("\n") !== [...EXPECTED_ASSETS].sort().join("\n")) {
    throw new Error(`artifact set must be exactly ${EXPECTED_ASSETS.join(", ")}; got ${names.join(", ")}`);
  }
  const files = new Map();
  for (const name of EXPECTED_ASSETS) files.set(name, await readFile(`${input.assetDir}/${name}`));

  let releases = await api.listReleases();
  let release = releaseForTag(releases, input.tag);
  let tagSha = await api.resolveTagOrNull(input.tag);
  if (release && !release.draft) {
    if (!release.prerelease || tagSha !== sha) throw new Error(`${input.tag} is published with conflicting identity`);
    return { alreadyPublished: true, release };
  }
  await requireLatestStableSnapshot(input, api, releases);
  if (await api.resolveTagOrNull(`v${base}`)) {
    throw new Error(`stable v${base} appeared before RC publication`);
  }

  if (release) {
    const matchingSource =
      tagSha === sha || (!tagSha && release.target_commitish === sha);
    if (Number(input.runAttempt) <= 1 || !release.prerelease || !matchingSource) {
      throw new Error(`${input.tag} draft cannot be resumed by this run`);
    }
  } else {
    if (tagSha) throw new Error(`${input.tag} standalone tag blocks publication`);
    release = await api.createRelease({ tag: input.tag, sha });
    if (!release.draft || !release.prerelease) {
      throw new Error("new RC release was not a draft prerelease");
    }
  }
  if (!tagSha) {
    await api.createTagRef(input.tag, sha);
    tagSha = await api.resolveTag(input.tag);
  }
  if (tagSha !== sha) throw new Error("RC tag does not match candidate SHA");

  const existingNames = new Set((release.assets || []).map((asset) => asset.name));
  const unexpected = [...existingNames].filter((name) => !EXPECTED_ASSETS.includes(name));
  if (unexpected.length) throw new Error(`draft contains unexpected assets: ${unexpected.join(", ")}`);

  for (const asset of release.assets || []) {
    const local = files.get(asset.name);
    const remote = await api.downloadAsset(asset);
    if (!sameBytes(local, remote)) throw new Error(`draft asset ${asset.name} does not match this run`);
  }
  for (const name of EXPECTED_ASSETS) {
    if (!existingNames.has(name)) await api.uploadAsset(release.id, name, files.get(name));
  }

  release = await api.getRelease(release.id);
  const finalNames = (release.assets || []).map((asset) => asset.name).sort();
  if (finalNames.join("\n") !== [...EXPECTED_ASSETS].sort().join("\n")) {
    throw new Error(`draft asset verification failed: ${finalNames.join(", ")}`);
  }
  for (const asset of release.assets || []) {
    const remote = await api.downloadAsset(asset);
    if (!sameBytes(files.get(asset.name), remote)) {
      throw new Error(`uploaded asset ${asset.name} failed byte-for-byte verification`);
    }
  }
  releases = await api.listReleases();
  await requireLatestStableSnapshot(input, api, releases);
  if (await api.resolveTagOrNull(`v${base}`)) {
    throw new Error(`stable v${base} appeared during RC publication`);
  }
  if ((await api.resolveTag(input.tag)) !== sha) throw new Error("RC tag moved before publication");

  release = await api.publishRelease(release.id);
  if (release.draft || !release.prerelease) throw new Error("GitHub did not publish the RC as a prerelease");
  return { alreadyPublished: false, release };
}

function writeOutputs(values) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  return import("node:fs/promises").then(({ appendFile }) => appendFile(output, `${lines.join("\n")}\n`));
}

function repositoryApi() {
  const repo = process.env.GITHUB_REPOSITORY || "arcee-ai/nac";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required");
  return new GitHubApi({
    repo,
    token,
    apiBase: process.env.NAC_GITHUB_API_BASE_URL,
    uploadsBase: process.env.NAC_GITHUB_UPLOADS_BASE_URL,
  });
}

async function main() {
  const command = process.argv[2];
  const api = repositoryApi();
  if (command === "prepare") {
    const result = await prepareCandidate(
      {
        sha: process.env.GITHUB_SHA,
        runNumber: process.env.GITHUB_RUN_NUMBER,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      },
      api,
    );
    await writeOutputs({
      run: result.run,
      sha: result.sha || process.env.GITHUB_SHA,
      base: result.base || "",
      version: result.version || "",
      tag: result.tag || "",
      resume: result.resume || false,
      reason: result.reason || "",
      latest_stable_tag: result.latestStableTag || "",
      latest_stable_sha: result.latestStableSha || "",
    });
    console.log(result.reason || `${result.resume ? "resuming" : "preparing"} ${result.tag}`);
  } else if (command === "validate-stable") {
    const result = await validateStableDispatch(process.env.RELEASE_TAG, api);
    await writeOutputs({ run: true, sha: result.sha, version: result.version, tag: result.tag });
  } else if (command === "publish") {
    const result = await publishCandidate(
      {
        sha: process.env.CANDIDATE_SHA,
        tag: process.env.RELEASE_TAG,
        runNumber: process.env.GITHUB_RUN_NUMBER,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT,
        assetDir: process.env.ASSET_DIR || "dist",
        latestStableTag: process.env.LATEST_STABLE_TAG,
        latestStableSha: process.env.LATEST_STABLE_SHA,
      },
      api,
    );
    console.log(result.alreadyPublished ? `${process.env.RELEASE_TAG} was already published` : `published ${process.env.RELEASE_TAG}`);
  } else {
    throw new Error(`usage: ${process.argv[1]} prepare|validate-stable|publish`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
