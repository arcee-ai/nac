import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/u;
const STABLE_TAG = /^refs\/tags\/v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const RELEASE_BRANCH = "release-please--branches--release-preparation-source--components--nac";
const POLICY_REF = "refs/heads/dev";
const RECEIPT_KEYS = [
  "schema_version",
  "repository",
  "ref",
  "sha",
  "candidate_sha",
  "event_name",
  "event_ref",
  "event_sha",
  "run_id",
  "run_attempt",
];

function eventContext(environment) {
  const repository = environment.GITHUB_REPOSITORY;
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository || "") ||
    !environment.GITHUB_EVENT_PATH
  ) {
    throw new Error("trusted GitHub repository/event context is required");
  }
  const event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8"));
  if (event.repository?.full_name !== repository)
    throw new Error("event repository identity mismatch");
  return { repository, event };
}

function publicationIdentity(candidateSha, environment) {
  if (!SHA.test(candidateSha || "")) throw new Error("invalid immutable publication candidate");
  const { repository, event } = eventContext(environment);
  const name = environment.GITHUB_EVENT_NAME;
  const ref = environment.GITHUB_REF;
  if (name === "push" && STABLE_TAG.test(ref || "")) {
    if (event.ref !== ref || event.deleted === true) throw new Error("invalid stable tag event");
  } else if (name === "pull_request" && event.action === "closed" && ref === POLICY_REF) {
    const pr = event.pull_request;
    if (
      pr?.merged !== true ||
      pr.merge_commit_sha !== candidateSha ||
      pr.base?.ref !== "dev" ||
      pr.base?.repo?.full_name !== repository ||
      pr.head?.repo?.full_name !== repository ||
      pr.head?.ref !== RELEASE_BRANCH ||
      !Number.isSafeInteger(pr.number) ||
      pr.number < 1
    ) {
      throw new Error("publication requires the exact merged release PR from this repository");
    }
  } else {
    throw new Error("publication policy is unavailable to PR/ordinary/manual events");
  }
  if (
    !SHA.test(environment.GITHUB_SHA || "") ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ID || "") ||
    !/^\d+$/u.test(environment.GITHUB_RUN_ATTEMPT || "")
  )
    throw new Error("missing publication run identity");
  return {
    repository,
    candidate_sha: candidateSha,
    event_name: name,
    event_ref: ref,
    event_sha: environment.GITHUB_SHA,
    run_id: environment.GITHUB_RUN_ID,
    run_attempt: environment.GITHUB_RUN_ATTEMPT,
  };
}

export function selectPolicyInputs(candidateSha, environment = process.env, readRef) {
  if (!SHA.test(candidateSha || "")) throw new Error("invalid source candidate");
  const { event, repository } = eventContext(environment);
  if (environment.GITHUB_EVENT_NAME === "push" && STABLE_TAG.test(environment.GITHUB_REF || "")) {
    publicationIdentity(candidateSha, environment);
    return { mode: "publication", policy_sha: "" };
  }
  let sha;
  if (environment.GITHUB_EVENT_NAME === "pull_request") sha = event.pull_request?.base?.sha;
  else if (environment.GITHUB_EVENT_NAME === "workflow_dispatch")
    sha = canonicalDev(repository, readRef);
  else if (
    environment.GITHUB_EVENT_NAME === "push" &&
    ["refs/heads/dev", "refs/heads/main"].includes(environment.GITHUB_REF)
  ) {
    if (event.ref !== environment.GITHUB_REF || event.deleted === true)
      throw new Error("invalid branch event");
    sha =
      environment.GITHUB_REF === "refs/heads/dev"
        ? candidateSha
        : canonicalDev(repository, readRef);
  } else
    throw new Error("ordinary policy requires a PR base, canonical dev, or protected branch push");
  if (!SHA.test(sha || "")) throw new Error("missing ordinary trusted base SHA");
  return { mode: "ordinary", policy_sha: sha };
}

export function resolvePublicationPolicy({
  candidateSha,
  requestedPolicySha = "",
  environment = process.env,
  readRef,
}) {
  if (requestedPolicySha)
    throw new Error("publication callers cannot select a trusted policy commit");
  const identity = publicationIdentity(candidateSha, environment);
  return {
    schema_version: 1,
    ...identity,
    ref: POLICY_REF,
    sha: canonicalDev(identity.repository, readRef),
  };
}

function canonicalDev(repository, readRef) {
  const endpoint = `repos/${repository}/git/ref/heads/dev`;
  const response = readRef
    ? readRef(endpoint)
    : JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8", timeout: 30_000 }));
  if (
    response?.ref !== POLICY_REF ||
    response.url !== `https://api.github.com/repos/${repository}/git/refs/heads/dev` ||
    response.object?.type !== "commit" ||
    !SHA.test(response.object.sha || "") ||
    response.object.url !==
      `https://api.github.com/repos/${repository}/git/commits/${response.object.sha}`
  ) {
    throw new Error("canonical reviewed-dev policy ref/commit identity mismatch");
  }
  return response.object.sha;
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function checkout(root, sha, repository) {
  if (
    realpathSync(git(root, "rev-parse", "--show-toplevel")) !== realpathSync(root) ||
    git(root, "rev-parse", "HEAD") !== sha ||
    git(root, "remote", "get-url", "origin").replace(/\.git$/u, "") !==
      `https://github.com/${repository}`
  ) {
    throw new Error("publication checkout repository/commit identity mismatch");
  }
}

export function validatePublicationPolicy(
  receipt,
  { candidateRoot, trustedRoot, environment = process.env },
) {
  if (
    !receipt ||
    Object.keys(receipt).sort().join() !== [...RECEIPT_KEYS].sort().join() ||
    receipt.schema_version !== 1 ||
    receipt.ref !== POLICY_REF ||
    !SHA.test(receipt.sha || "")
  ) {
    throw new Error("invalid pinned publication policy receipt");
  }
  const identity = publicationIdentity(receipt.candidate_sha, environment);
  if (environment.NAC_PUBLICATION_POLICY_SHA !== receipt.sha) {
    throw new Error("publication receipt differs from the independently pinned policy output");
  }
  for (const [key, value] of Object.entries(identity)) {
    if (receipt[key] !== value)
      throw new Error("publication policy receipt/event identity mismatch");
  }
  checkout(candidateRoot, receipt.candidate_sha, receipt.repository);
  checkout(trustedRoot, receipt.sha, receipt.repository);
  // One policy revision was captured from canonical dev. Never re-resolve a mutable
  // ref between checkout, evaluation, and reporting. Candidate remains immutable.
  git(trustedRoot, "merge-base", "--is-ancestor", receipt.candidate_sha, receipt.sha);
  for (const path of [".github/security/exceptions.json", ".github/security/osv-scanner.toml"]) {
    git(trustedRoot, "cat-file", "-e", `${receipt.sha}:${path}`);
  }
  for (const path of [
    "Cargo.lock",
    "crates/nac-server/web/package-lock.json",
    ".github/scripts/package-lock.json",
  ]) {
    git(candidateRoot, "cat-file", "-e", `${receipt.candidate_sha}:${path}`);
  }
  git(
    trustedRoot,
    "diff",
    "--quiet",
    receipt.sha,
    "--",
    ".github/security/exceptions.json",
    ".github/security/osv-scanner.toml",
  );
  git(
    candidateRoot,
    "diff",
    "--quiet",
    receipt.candidate_sha,
    "--",
    "Cargo.lock",
    "crates/nac-server/web/package-lock.json",
    ".github/scripts/package-lock.json",
  );
  if (identity.event_name === "push") {
    if (
      git(trustedRoot, "rev-parse", `${identity.event_ref}^{commit}`) !== receipt.candidate_sha ||
      ![receipt.candidate_sha, git(trustedRoot, "rev-parse", identity.event_ref)].includes(
        identity.event_sha,
      )
    ) {
      throw new Error("publication candidate does not match the immutable event tag");
    }
  } else if (identity.event_sha !== receipt.candidate_sha) {
    throw new Error("merged publication event SHA differs from candidate");
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, candidateSha, output] = process.argv.slice(2);
    if (command === "select" && candidateSha && !output) {
      for (const [key, value] of Object.entries(selectPolicyInputs(candidateSha)))
        console.log(`${key}=${value}`);
    } else if (command === "resolve" && candidateSha && output) {
      mkdirSync(output, { recursive: true });
      const receipt = resolvePublicationPolicy({
        candidateSha,
        requestedPolicySha: process.env.REQUESTED_POLICY_SHA,
      });
      writeFileSync(
        resolve(output, "publication-policy.json"),
        JSON.stringify(receipt, null, 2) + "\n",
      );
      console.log(`sha=${receipt.sha}`);
    } else
      throw new Error(
        "usage: publication-policy.mjs select CANDIDATE_SHA | resolve CANDIDATE_SHA REPORT_DIRECTORY",
      );
  } catch (error) {
    console.error(`publication policy resolution failed: ${error.message}`);
    process.exitCode = 1;
  }
}
