import fs from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  const match = SEMVER.exec(value.trim());
  if (!match) throw new Error(`expected a stable semantic version, got ${JSON.stringify(value)}`);
  return match.slice(1).map(Number);
}

export function nextVersion(current, commits) {
  const [major, minor, patch] = parseVersion(current);
  const breaking = commits.some((commit) =>
    /(^|\n)BREAKING[ -]CHANGE:/m.test(commit) || /^[a-z][a-z0-9-]*(\([^)]*\))?!:/i.test(commit),
  );
  const feature = commits.some((commit) => /^feat(?:\([^)]*\))?:/i.test(commit));
  if (major === 0 && (breaking || feature)) return `${major}.${minor + 1}.0`;
  if (breaking) return `${major + 1}.0.0`;
  if (feature) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function validateStable(tag, productVersion) {
  const expected = `v${productVersion.trim()}`;
  if (tag !== expected) throw new Error(`stable tag ${tag} does not match product version ${expected}`);
  parseVersion(productVersion);
}

export function validateDevAncestry(commit, devRef, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(`expected a full stable commit SHA, got ${JSON.stringify(commit)}`);
  }
  if (!devRef) throw new Error("DEV_REF is required");
  const result = spawnSync("git", ["merge-base", "--is-ancestor", commit, devRef], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(`stable commit ${commit} is not an ancestor of ${devRef}`);
  }
  const detail = (result.stderr || result.error?.message || "git ancestry check failed").trim();
  throw new Error(`failed to validate stable commit ancestry: ${detail}`);
}

function main() {
  const command = process.argv[2];
  if (command !== "validate-stable") {
    throw new Error(`usage: ${process.argv[1]} validate-stable`);
  }
  const tag = process.env.RELEASE_TAG;
  if (!tag) throw new Error("RELEASE_TAG is required");
  validateStable(tag, fs.readFileSync("version.txt", "utf8"));
  const sourceSha = process.env.SOURCE_SHA;
  if (!sourceSha) throw new Error("SOURCE_SHA is required");
  validateDevAncestry(sourceSha, process.env.DEV_REF);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
