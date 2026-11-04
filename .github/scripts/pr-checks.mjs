import { execFileSync } from "node:child_process";
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

// A failed-job rerun can legitimately retain successful upstream outputs from
// an earlier attempt. Never reuse that stale receipt: validate its complete
// same-run identity, then repeat full quality in this attempt instead.
export function qualityMode(receipt, sha, context) {
  qualityIdentity(sha, context);
  if (receipt === null) return "full";
  verifyQuality(receipt, sha, { ...context, run_attempt: receipt.run_attempt });
  if (BigInt(receipt.run_attempt) > BigInt(context.run_attempt)) {
    throw new Error("quality receipt is from a future attempt");
  }
  return receipt.run_attempt === context.run_attempt ? "reuse" : "full";
}

// Still fails closed: this only labels why the aggregate is red.
export class CancelledCandidate extends Error {}

function rejectFailedOrCancelled(needs, derivedFailures = []) {
  const withResult = (result) =>
    Object.keys(needs)
      .filter((job) => needs[job]?.result === result && !derivedFailures.includes(job))
      .sort()
      .join(", ");
  const failed = withResult("failure");
  const cancelled = withResult("cancelled");
  if (failed) {
    throw new Error(`${failed} did not succeed${cancelled ? `; also cancelled: ${cancelled}` : ""}`);
  }
  if (cancelled) {
    throw new CancelledCandidate(
      `${cancelled} did not succeed: cancelled, and no job failed. This candidate is unqualified. ` +
        "Check for a newer run of this head; a job timeout also reports as cancelled.",
    );
  }
}

export const managedJobs = ["prepare", "contract", "quality", "build-smoke"];

export function requireManagedComplete(needs, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("invalid candidate SHA");
  if (Object.keys(needs).sort().join() !== [...managedJobs].sort().join()) {
    throw new Error("managed dependency set differs from its explicit contract");
  }
  rejectFailedOrCancelled(needs);
  if (needs.prepare?.outputs?.sha !== expectedSha) {
    throw new Error("managed preparation did not bind the caller's candidate");
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

// quality and test only summarize their dependencies: cancelling one fails them.
function failedByCancellation(needs) {
  const cancelled = (job) => needs[job]?.result === "cancelled";
  const quality = needs.quality?.result === "failure" && qualityJobs.some(cancelled);
  const test = needs.test?.result === "failure" && (quality || cancelled("quality") || cancelled("browser"));
  return [...(quality ? ["quality"] : []), ...(test ? ["test"] : [])];
}

function requireReusedComplete(needs, reused, attempt) {
  if (!/^[1-9][0-9]*$/.test(reused)) throw new Error("invalid reused run identity");
  // A failed-job rerun keeps prepare's old decision; only a full rerun re-decides.
  if (attempt !== "1") throw new Error("a reused run cannot be rerun in part; re-run all jobs");
  for (const job of [...requiredJobs, "managed"]) {
    const expected = ["prepare", "source-security"].includes(job) ? "success" : "skipped";
    if (needs[job]?.result !== expected) throw new Error(`${job} must be ${expected} when reusing a run`);
  }
}

// Reuses a full run of this exact merge only if nothing later on this head failed.
export async function findQualifiedRun(
  { repository, mergeSha, headSha, baseSha, prNumber, parents, currentRun, currentAttempt, token },
  fetcher = fetch,
) {
  const shaPattern = /^[a-f0-9]{40}$/;
  if (![mergeSha, headSha, baseSha].every((sha) => shaPattern.test(sha ?? ""))) return null;
  if (parents?.[0] !== baseSha || parents?.[1] !== headSha || currentAttempt !== "1") return null;
  const read = async (path) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/actions/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response.json();
  };
  try {
    const { artifacts } = await read(`artifacts?name=qualified-${mergeSha}&per_page=100`);
    const qualified = new Set(
      artifacts
        .filter((artifact) => !artifact.expired && artifact.workflow_run?.head_sha === headSha)
        .map((artifact) => artifact.workflow_run.id),
    );
    if (qualified.size === 0) return null;
    const { workflow_runs: runs } = await read(`runs?head_sha=${headSha}&event=pull_request&per_page=100`);
    const others = runs.filter(
      (run) => run.path === ".github/workflows/stable-release.yml" && String(run.id) !== currentRun,
    );
    const succeeded = (run) =>
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.pull_requests?.some(
        (pr) => String(pr.number) === prNumber && pr.base?.sha === baseSha && pr.head?.sha === headSha,
      );
    const marked = others
      .filter((run) => qualified.has(run.id) && succeeded(run))
      .sort((left, right) => right.run_number - left.run_number)[0];
    if (!marked) return null;
    for (const run of others) {
      const later = run.run_number > marked.run_number || run.updated_at > marked.updated_at;
      if (!later || succeeded(run)) continue;
      // A newer edit replaces a pending edit run, which cancels it before any job starts.
      const replaced = run.conclusion === "cancelled" && (await read(`runs/${run.id}/jobs`)).total_count === 0;
      if (!replaced) return null;
    }
    return String(marked.id);
  } catch (error) {
    console.error(`Running full qualification: ${error.message}`);
  }
  return null;
}

export function requireComplete(needs, managed, expectedSha, attempt) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) throw new Error("invalid candidate SHA");
  const expected = [...requiredJobs, "managed"];
  if (Object.keys(needs).sort().join() !== expected.sort().join()) {
    throw new Error("aggregate dependency set differs from its explicit contract");
  }
  rejectFailedOrCancelled(needs, failedByCancellation(needs));
  if (!["true", "false"].includes(managed)) throw new Error("missing/invalid applicability");
  const reused = needs.prepare?.outputs?.reused_run;
  if (needs.prepare?.outputs?.sha !== expectedSha ||
      needs.prepare?.outputs?.run !== (reused ? "false" : "true")) {
    throw new Error("preparation did not bind the current workflow candidate");
  }
  if (reused) return requireReusedComplete(needs, reused, attempt);
  for (const job of requiredJobs) {
    if (needs[job]?.result !== "success") throw new Error(`${job} did not succeed`);
  }
  const managedResult = managed === "true" ? "success" : "skipped";
  if (needs.managed?.result !== managedResult) throw new Error(`managed must be ${managedResult}`);
}

function reportCancellation(check) {
  try {
    check();
  } catch (error) {
    if (!(error instanceof CancelledCandidate)) throw error;
    console.log(`::warning title=Cancelled run with no failed job::${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "metadata-reuse") {
    const parents = execFileSync("git", ["rev-parse", "HEAD^1", "HEAD^2"], { encoding: "utf8" })
      .trim()
      .split("\n");
    const run = await findQualifiedRun({
      repository: process.env.GITHUB_REPOSITORY,
      mergeSha: process.env.MERGE_SHA,
      headSha: process.env.HEAD_SHA,
      baseSha: process.env.BASE_SHA,
      prNumber: process.env.PR_NUMBER,
      parents,
      currentRun: process.env.GITHUB_RUN_ID,
      currentAttempt: process.env.GITHUB_RUN_ATTEMPT,
      token: process.env.GH_TOKEN,
    });
    if (run) console.log(`reused_run=${run}`);
  } else if (process.argv[2] === "applicability") {
    const paths = fs.readFileSync(process.argv[3], "utf8").split("\0").filter(Boolean);
    console.log(`managed_applicable=${managedApplicable(paths)}`);
  } else if (["quality-receipt", "verify-quality", "quality-mode"].includes(process.argv[2])) {
    const context = { run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT, repository: process.env.GITHUB_REPOSITORY };
    if (process.argv[2] === "quality-receipt") {
      console.log(`quality_receipt=${JSON.stringify(qualityReceipt(JSON.parse(process.env.NEEDS_JSON), process.env.EXPECTED_SHA, context))}`);
    } else if (process.argv[2] === "quality-mode") {
      const receipt = process.env.QUALITY_RECEIPT ? JSON.parse(process.env.QUALITY_RECEIPT) : null;
      console.log(`mode=${qualityMode(receipt, process.env.EXPECTED_SHA, context)}`);
    } else {
      verifyQuality(JSON.parse(process.env.QUALITY_RECEIPT), process.env.EXPECTED_SHA, context);
      console.log("Verified complete quality results for this exact candidate/run/attempt");
    }
  } else if (process.argv[2] === "aggregate") {
    reportCancellation(() =>
      requireComplete(
        JSON.parse(process.env.NEEDS_JSON),
        process.env.MANAGED_APPLICABLE,
        process.env.EXPECTED_SHA,
        process.env.GITHUB_RUN_ATTEMPT,
      ),
    );
    console.log("All applicable checks succeeded for this workflow candidate");
  } else if (process.argv[2] === "managed-aggregate") {
    reportCancellation(() =>
      requireManagedComplete(JSON.parse(process.env.NEEDS_JSON), process.env.EXPECTED_SHA),
    );
    console.log("All managed checks succeeded for the caller's candidate");
  } else {
    throw new Error(
      "usage: pr-checks.mjs applicability <NUL-path-file> | metadata-reuse | aggregate | managed-aggregate",
    );
  }
}
