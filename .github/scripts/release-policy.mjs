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

export function validatePreparationSource({
  eventName,
  eventRef,
  eventSha,
  requestedSha,
  devSha,
}) {
  if (eventName !== "workflow_dispatch") {
    throw new Error(`stable preparation requires workflow_dispatch, got ${JSON.stringify(eventName)}`);
  }
  if (eventRef !== "refs/heads/dev") {
    throw new Error(`stable preparation must be dispatched against dev, got ${JSON.stringify(eventRef)}`);
  }
  for (const [name, value] of [
    ["event SHA", eventSha],
    ["requested dev SHA", requestedSha],
    ["current dev SHA", devSha],
  ]) {
    if (!/^[0-9a-f]{40}$/i.test(value || "")) {
      throw new Error(`expected a full ${name}, got ${JSON.stringify(value)}`);
    }
  }
  if (requestedSha.toLowerCase() !== eventSha.toLowerCase()) {
    throw new Error(`requested dev SHA ${requestedSha} does not match dispatched source ${eventSha}`);
  }
  if (devSha.toLowerCase() !== eventSha.toLowerCase()) {
    throw new Error(`dispatched source ${eventSha} is not the current dev tip ${devSha}`);
  }
}

function main() {
  const command = process.argv[2];
  if (command === "validate-prepare") {
    validatePreparationSource({
      eventName: process.env.EVENT_NAME,
      eventRef: process.env.EVENT_REF,
      eventSha: process.env.EVENT_SHA,
      requestedSha: process.env.REQUESTED_SHA,
      devSha: process.env.DEV_SHA,
    });
    return;
  }
  if (command !== "validate-stable") {
    throw new Error(`usage: ${process.argv[1]} validate-prepare|validate-stable`);
  }
  const tag = process.env.RELEASE_TAG;
  if (!tag) throw new Error("RELEASE_TAG is required");
  validateStable(tag, fs.readFileSync("version.txt", "utf8"));
  const sourceSha = process.env.SOURCE_SHA;
  if (!sourceSha) throw new Error("SOURCE_SHA is required");
  validateDevAncestry(sourceSha, process.env.DEV_REF);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
