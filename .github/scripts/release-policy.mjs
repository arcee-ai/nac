import fs from "node:fs";
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

function main() {
  const command = process.argv[2];
  if (command !== "validate-stable") {
    throw new Error(`usage: ${process.argv[1]} validate-stable`);
  }
  const tag = process.env.RELEASE_TAG;
  if (!tag) throw new Error("RELEASE_TAG is required");
  validateStable(tag, fs.readFileSync("version.txt", "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
