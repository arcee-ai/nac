import fs from "node:fs";
import { pathToFileURL } from "node:url";

// The graph and this list change together when adding a required lane. Never
// infer expected work from the jobs which happen to have reported a result.
export const requiredJobs = [
  "prepare",
  "lint",
  "workflow-lint",
  "test-server",
  "test-core",
  "test-workspace",
  "quality",
  "browser",
  "test",
  "build",
  "source-security",
  "macos-native",
];
// A receipt is only an optimization within this run, never reusable evidence
// from another run, attempt, repository, candidate or partial result set.
export const qualityJobs = ["prepare", "lint", "workflow-lint", "test-server", "test-core", "test-workspace"];

function qualityIdentity(sha, context) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") ||
      !/^[1-9][0-9]*$/.test(context.run_id ?? "") ||
      !/^[1-9][0-9]*$/.test(context.run_attempt ?? "") ||
      !/^[\w.-]+\/[\w.-]+$/.test(context.repository ?? "")) {
    throw new Error("invalid same-run quality identity");
  }
  return { sha, ...context };
}

function successfulQuality(results) {
  if (!results || Object.keys(results).sort().join() !== [...qualityJobs].sort().join()) {
    throw new Error("quality dependency set differs from its explicit contract");
  }
  for (const job of qualityJobs) {
    if (results[job] !== "success") throw new Error(`${job} did not succeed`);
  }
}

export function qualityReceipt(needs, sha, context) {
  const identity = qualityIdentity(sha, context);
  if (needs.prepare?.outputs?.sha !== sha || needs.prepare?.outputs?.run !== "true") {
    throw new Error("quality preparation did not bind the current candidate");
  }
  const results = Object.fromEntries(Object.entries(needs).map(([job, value]) => [job, value?.result]));
  successfulQuality(results);
  return { ...identity, results };
}

export function verifyQuality(receipt, sha, context) {
  const identity = qualityIdentity(sha, context);
  if (!receipt || Object.keys(receipt).sort().join() !== [...Object.keys(identity), "results"].sort().join()) {
    throw new Error("invalid quality receipt fields");
  }
  for (const [key, value] of Object.entries(identity)) {
    if (receipt[key] !== value) throw new Error(`quality receipt ${key} differs from this run`);
  }
  successfulQuality(receipt.results);
}

export const managedJobs = ["prepare", "contract", "quality", "build-smoke"];

export function requireManagedComplete(needs, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "") || needs.prepare?.outputs?.sha !== expectedSha) {
    throw new Error("managed preparation did not bind the caller's candidate");
  }
  if (Object.keys(needs).sort().join() !== [...managedJobs].sort().join()) {
    throw new Error("managed dependency set differs from its explicit contract");
  }
  for (const job of managedJobs) {
    if (needs[job]?.result !== "success") throw new Error(`${job} did not succeed`);
  }
}

export function managedApplicable(paths) {
  return paths.some(
    (path) =>
      /^(?:\.github\/|crates\/|docker\/managed\/|scripts\/)/.test(path) ||
      ["Cargo.toml", "Cargo.lock", "Makefile", ".dockerignore", "version.txt"].includes(path),
  );
}

export function requireComplete(needs, managed, expectedSha) {
  if (!["true", "false"].includes(managed)) throw new Error("missing/invalid applicability");
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("invalid candidate SHA");
  if (needs.prepare?.outputs?.sha !== expectedSha || needs.prepare?.outputs?.run !== "true") {
    throw new Error("preparation did not bind the current workflow candidate");
  }
  const expected = [...requiredJobs, "managed"];
  if (Object.keys(needs).sort().join() !== expected.sort().join()) {
    throw new Error("aggregate dependency set differs from its explicit contract");
  }
  for (const job of requiredJobs) {
    if (needs[job]?.result !== "success") throw new Error(`${job} did not succeed`);
  }
  const managedResult = managed === "true" ? "success" : "skipped";
  if (needs.managed?.result !== managedResult) throw new Error(`managed must be ${managedResult}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "applicability") {
    const paths = fs.readFileSync(process.argv[3], "utf8").split("\0").filter(Boolean);
    console.log(`managed_applicable=${managedApplicable(paths)}`);
  } else if (["quality-receipt", "verify-quality"].includes(process.argv[2])) {
    const context = { run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY };
    if (process.argv[2] === "quality-receipt") {
      console.log(`quality_receipt=${JSON.stringify(qualityReceipt(JSON.parse(process.env.NEEDS_JSON), process.env.EXPECTED_SHA, context))}`);
    } else {
      verifyQuality(JSON.parse(process.env.QUALITY_RECEIPT), process.env.EXPECTED_SHA, context);
      console.log("Verified complete quality results for this exact candidate/run/attempt");
    }
  } else if (process.argv[2] === "aggregate") {
    requireComplete(
      JSON.parse(process.env.NEEDS_JSON),
      process.env.MANAGED_APPLICABLE,
      process.env.EXPECTED_SHA,
    );
    console.log("All applicable checks succeeded for this workflow candidate");
  } else if (process.argv[2] === "managed-aggregate") {
    requireManagedComplete(JSON.parse(process.env.NEEDS_JSON), process.env.EXPECTED_SHA);
    console.log("All managed checks succeeded for the caller's candidate");
  } else {
    throw new Error(
      "usage: pr-checks.mjs applicability <NUL-path-file> | aggregate | managed-aggregate",
    );
  }
}
