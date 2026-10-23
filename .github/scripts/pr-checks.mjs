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
  "test",
  "build",
  "source-security",
];
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
