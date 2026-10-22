import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolvePublicationPolicy,
  selectPolicyInputs,
  validatePublicationPolicy,
} from "./publication-policy.mjs";
import { CONFIG, INPUTS, POLICY, loadTrustedPolicy, scanSources } from "./source-security.mjs";
import { evaluateFindings } from "./security-policy.mjs";

const now = new Date("2026-10-22T00:00:00Z");
const empty = { schema_version: 1, exceptions: [] };
const entry = {
  advisory: "TEST-RECOVERY",
  package: "npm:fixture",
  context: INPUTS[1],
  reason: "Fixture only; no production exception approval",
  owner: "@fixture-owner",
  linked_issue: "https://example.invalid/issues/fixture",
  expires: "2026-10-23T12:00:00Z",
};
const policy = (value) => ({ schema_version: 1, exceptions: [value] });
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function fixture(
  t,
  {
    candidatePolicy = empty,
    trustedPolicy = policy(entry),
    vulnerable = false,
    annotated = false,
    missingPolicy = false,
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "nac-publication-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidateRoot = join(directory, "candidate");
  const trustedRoot = join(directory, "reviewed-dev");
  mkdirSync(candidateRoot);
  git(candidateRoot, "init", "--quiet");
  git(candidateRoot, "config", "user.name", "Fixture");
  git(candidateRoot, "config", "user.email", "fixture@example.invalid");
  git(candidateRoot, "config", "commit.gpgSign", "false");
  git(candidateRoot, "config", "tag.gpgSign", "false");
  git(candidateRoot, "config", "tag.forceSignAnnotated", "false");
  git(candidateRoot, "remote", "add", "origin", "https://github.com/example/fixture.git");
  for (const input of INPUTS) {
    mkdirSync(join(candidateRoot, dirname(input)), { recursive: true });
    const kind = vulnerable && input === INPUTS[1] ? "vulnerable" : "safe";
    copyFileSync(
      fileURLToPath(
        new URL(
          `./fixtures/security/${kind}/${input === INPUTS[0] ? "Cargo.lock" : "package-lock.json"}`,
          import.meta.url,
        ),
      ),
      join(candidateRoot, input),
    );
  }
  mkdirSync(join(candidateRoot, dirname(POLICY)), { recursive: true });
  writeFileSync(join(candidateRoot, CONFIG), "# No OSV overrides\n");
  writeFileSync(join(candidateRoot, POLICY), JSON.stringify(candidatePolicy));
  git(candidateRoot, "add", ".");
  git(candidateRoot, "commit", "--quiet", "-m", "immutable candidate");
  const candidateSha = git(candidateRoot, "rev-parse", "HEAD");
  if (annotated) git(candidateRoot, "tag", "-a", "v0.1.5", "-m", "fixture tag");
  else git(candidateRoot, "tag", "v0.1.5");
  if (typeof trustedPolicy === "function")
    trustedPolicy = trustedPolicy({ candidateRoot, directory });
  if (missingPolicy) rmSync(join(candidateRoot, POLICY));
  else
    writeFileSync(
      join(candidateRoot, POLICY),
      typeof trustedPolicy === "string" ? trustedPolicy : JSON.stringify(trustedPolicy),
    );
  git(candidateRoot, "add", ".");
  git(candidateRoot, "commit", "--quiet", "--allow-empty", "-m", "reviewed dev policy");
  const policySha = git(candidateRoot, "rev-parse", "HEAD");
  git(candidateRoot, "worktree", "add", "--detach", trustedRoot, policySha);
  git(candidateRoot, "checkout", "--detach", candidateSha);
  const eventPath = join(directory, "event.json");
  const event = {
    ref: "refs/tags/v0.1.5",
    deleted: false,
    repository: { full_name: "example/fixture" },
  };
  const saveEvent = (value) => writeFileSync(eventPath, JSON.stringify(value));
  saveEvent(event);
  const environment = {
    GITHUB_REPOSITORY: "example/fixture",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: event.ref,
    GITHUB_SHA: annotated ? git(candidateRoot, "rev-parse", event.ref) : candidateSha,
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "2",
    NAC_PUBLICATION_POLICY_SHA: policySha,
  };
  const response = {
    ref: "refs/heads/dev",
    url: "https://api.github.com/repos/example/fixture/git/refs/heads/dev",
    object: {
      type: "commit",
      sha: policySha,
      url: `https://api.github.com/repos/example/fixture/git/commits/${policySha}`,
    },
  };
  let reads = 0;
  const readRef = (endpoint) => {
    reads++;
    assert.equal(endpoint, "repos/example/fixture/git/ref/heads/dev");
    return response;
  };
  const receipt = resolvePublicationPolicy({ candidateSha, environment, readRef });
  return {
    candidateRoot,
    trustedRoot,
    candidateSha,
    policySha,
    environment,
    response,
    receipt,
    readRef,
    reads: () => reads,
    event,
    saveEvent,
    output: join(directory, "reports"),
    directory,
  };
}

test("a separately reviewed dev policy recovers the immutable tag without weakening ordinary equality", (t) => {
  const w = fixture(t);
  assert.deepEqual(selectPolicyInputs(w.candidateSha, w.environment), {
    mode: "publication",
    policy_sha: "",
  });
  const trusted = loadTrustedPolicy(w.candidateRoot, w.trustedRoot, {
    now,
    publicationPolicy: w.receipt,
    environment: w.environment,
  });
  assert.equal(evaluateFindings([entry], trusted, { now }).excepted.length, 1);
  assert.equal(
    evaluateFindings([{ ...entry, context: "managed-image" }], trusted, { now }).blocking.length,
    1,
  );
  assert.throws(
    () => loadTrustedPolicy(w.candidateRoot, w.trustedRoot, { now }),
    /differs from trusted base/u,
  );
  assert.equal(w.reads(), 1); // Validation/evaluation never re-resolves mutable dev.
  assert.equal(git(w.candidateRoot, "rev-parse", "HEAD"), w.candidateSha);
});

test("publication uses only current reviewed grants, including removal of an expired candidate grant", (t) => {
  const w = fixture(t, {
    candidatePolicy: policy({ ...entry, expires: "2026-10-21T12:00:00Z" }),
    trustedPolicy: empty,
  });
  const trusted = loadTrustedPolicy(w.candidateRoot, w.trustedRoot, {
    now,
    publicationPolicy: w.receipt,
    environment: w.environment,
  });
  assert.equal(evaluateFindings([entry], trusted, { now }).blocking.length, 1);
});

test("the same immutable candidate and publication binding supports annotated tags", (t) => {
  const w = fixture(t, { annotated: true });
  assert.equal(
    validatePublicationPolicy(w.receipt, { ...w, environment: w.environment }).sha,
    w.policySha,
  );
});

test("ordinary PR, manual, daily, foreign and non-release merged events cannot opt into publication policy", (t) => {
  const w = fixture(t);
  for (const name of ["pull_request", "workflow_dispatch", "schedule", "pull_request_target"]) {
    const environment = { ...w.environment, GITHUB_EVENT_NAME: name };
    assert.throws(() =>
      resolvePublicationPolicy({ candidateSha: w.candidateSha, environment, readRef: w.readRef }),
    );
  }
  w.saveEvent({ ...w.event, repository: { full_name: "attacker/fork" } });
  assert.throws(
    () =>
      resolvePublicationPolicy({
        candidateSha: w.candidateSha,
        environment: w.environment,
        readRef: w.readRef,
      }),
    /repository identity/u,
  );
});

test("manual CI pins canonical dev instead of trusting branch-authored exceptions", (t) => {
  const w = fixture(t, { candidatePolicy: policy(entry), trustedPolicy: empty });
  const environment = {
    ...w.environment,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/feature",
  };
  assert.deepEqual(selectPolicyInputs(w.candidateSha, environment, w.readRef), {
    mode: "ordinary",
    policy_sha: w.policySha,
  });
  assert.notEqual(w.policySha, w.candidateSha);
  assert.throws(
    () => loadTrustedPolicy(w.candidateRoot, w.trustedRoot, { now }),
    /differs from trusted base/u,
  );
  assert.throws(
    () =>
      selectPolicyInputs(w.candidateSha, environment, () => {
        throw new Error("policy unavailable");
      }),
    /unavailable/u,
  );
  for (const name of ["schedule", "unknown", "push"]) {
    assert.throws(() =>
      selectPolicyInputs(w.candidateSha, { ...environment, GITHUB_EVENT_NAME: name }, w.readRef),
    );
  }
  for (const ref of ["refs/heads/dev", "refs/heads/main"]) {
    w.saveEvent({ ...w.event, ref });
    assert.deepEqual(
      selectPolicyInputs(w.candidateSha, {
        ...environment,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: ref,
      }),
      { mode: "ordinary", policy_sha: w.candidateSha },
    );
  }
});

test("merged release PR publication is bound to the exact same-repository merge candidate", (t) => {
  const w = fixture(t);
  const pr = {
    number: 42,
    merged: true,
    merge_commit_sha: w.candidateSha,
    base: { ref: "dev", sha: w.policySha, repo: { full_name: "example/fixture" } },
    head: {
      ref: "release-please--branches--release-preparation-source--components--nac",
      repo: { full_name: "example/fixture" },
    },
  };
  const event = { action: "closed", repository: w.event.repository, pull_request: pr };
  w.saveEvent(event);
  const environment = {
    ...w.environment,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/heads/dev",
  };
  const receipt = resolvePublicationPolicy({
    candidateSha: w.candidateSha,
    environment,
    readRef: w.readRef,
  });
  assert.equal(
    validatePublicationPolicy(receipt, { ...w, environment }).candidate_sha,
    w.candidateSha,
  );
  for (const patch of [
    { merged: false },
    { merge_commit_sha: "b".repeat(40) },
    { head: { ...pr.head, ref: "feature" } },
    { head: { ...pr.head, repo: { full_name: "attacker/fork" } } },
  ]) {
    w.saveEvent({ ...event, pull_request: { ...pr, ...patch } });
    assert.throws(() =>
      resolvePublicationPolicy({ candidateSha: w.candidateSha, environment, readRef: w.readRef }),
    );
  }
  w.saveEvent({ ...event, action: "synchronize", pull_request: { ...pr, merged: false } });
  assert.deepEqual(selectPolicyInputs(w.candidateSha, environment), {
    mode: "ordinary",
    policy_sha: w.policySha,
  });
  assert.throws(() => validatePublicationPolicy(receipt, { ...w, environment }));
});

test("caller-selected, malformed, missing or unavailable policy refs fail closed", (t) => {
  const w = fixture(t);
  assert.throws(
    () =>
      resolvePublicationPolicy({
        candidateSha: w.candidateSha,
        environment: w.environment,
        requestedPolicySha: w.policySha,
        readRef: w.readRef,
      }),
    /cannot select/u,
  );
  for (const response of [
    null,
    {},
    { ...w.response, ref: "refs/heads/attacker" },
    { ...w.response, url: "https://api.github.com/repos/attacker/fork/git/refs/heads/dev" },
    { ...w.response, object: { ...w.response.object, type: "tag" } },
    { ...w.response, object: { ...w.response.object, sha: "missing" } },
  ]) {
    assert.throws(() =>
      resolvePublicationPolicy({
        candidateSha: w.candidateSha,
        environment: w.environment,
        readRef: () => response,
      }),
    );
  }
  assert.throws(
    () =>
      resolvePublicationPolicy({
        candidateSha: w.candidateSha,
        environment: w.environment,
        readRef: () => {
          throw new Error("policy network unavailable");
        },
      }),
    /unavailable/u,
  );
});

test("receipt/ref/run/commit spoofing, foreign checkout and moving tag cannot choose a policy", (t) => {
  const w = fixture(t);
  for (const patch of [
    { ref: "refs/heads/attacker" },
    { repository: "attacker/fork" },
    { sha: w.candidateSha },
    { candidate_sha: w.policySha },
    { run_id: "999" },
    { extra: "untrusted" },
  ]) {
    assert.throws(() => validatePublicationPolicy({ ...w.receipt, ...patch }, w));
  }
  assert.throws(
    () =>
      validatePublicationPolicy(w.receipt, {
        ...w,
        environment: { ...w.environment, NAC_PUBLICATION_POLICY_SHA: w.candidateSha },
      }),
    /independently pinned/u,
  );
  git(w.candidateRoot, "remote", "set-url", "origin", "https://github.com/attacker/fork.git");
  assert.throws(() => validatePublicationPolicy(w.receipt, w), /checkout repository/u);
  git(w.candidateRoot, "remote", "set-url", "origin", "https://github.com/example/fixture.git");
  git(w.candidateRoot, "update-ref", "refs/tags/v0.1.5", w.policySha);
  assert.throws(() => validatePublicationPolicy(w.receipt, w), /immutable event tag/u);
});

test("missing policy checkout, altered policy bytes and non-ancestor policy fail closed", (t) => {
  const w = fixture(t);
  writeFileSync(join(w.trustedRoot, POLICY), JSON.stringify(empty));
  assert.throws(() =>
    loadTrustedPolicy(w.candidateRoot, w.trustedRoot, {
      now,
      publicationPolicy: w.receipt,
      environment: w.environment,
    }),
  );
  git(w.trustedRoot, "checkout", "--", POLICY);
  const unrelated = git(
    w.trustedRoot,
    "commit-tree",
    git(w.trustedRoot, "rev-parse", "HEAD^{tree}"),
    "-m",
    "unrelated fixture",
  );
  git(w.trustedRoot, "checkout", "--detach", unrelated);
  assert.throws(() =>
    validatePublicationPolicy(
      { ...w.receipt, sha: unrelated },
      { ...w, environment: { ...w.environment, NAC_PUBLICATION_POLICY_SHA: unrelated } },
    ),
  );
  rmSync(w.trustedRoot, { recursive: true, force: true });
  assert.throws(() => validatePublicationPolicy(w.receipt, w));
});

for (const invalid of [
  "{",
  policy({ ...entry, expires: "2026-10-21T12:00:00Z" }),
  { schema_version: 1, exceptions: [{ ...entry, owner: "" }] },
]) {
  test("malformed/expired effective reviewed policy cannot fall back to candidate grants", (t) => {
    const w = fixture(t, { trustedPolicy: invalid });
    assert.throws(() =>
      loadTrustedPolicy(w.candidateRoot, w.trustedRoot, {
        now,
        publicationPolicy: w.receipt,
        environment: w.environment,
      }),
    );
  });
}

test("a policy file absent from the pinned commit cannot be supplied as an untracked replacement", (t) => {
  const w = fixture(t, { missingPolicy: true });
  writeFileSync(join(w.trustedRoot, POLICY), JSON.stringify(policy(entry)));
  assert.throws(() =>
    loadTrustedPolicy(w.candidateRoot, w.trustedRoot, {
      now,
      publicationPolicy: w.receipt,
      environment: w.environment,
    }),
  );
});

test(
  "real pinned scanner recovers historical publication only through reviewed exact exceptions",
  {
    skip: !process.env.OSV_SCANNER && "requires verified pinned OSV_SCANNER",
  },
  (t) => {
    let baseline;
    const w = fixture(t, {
      vulnerable: true,
      trustedPolicy: ({ candidateRoot, directory }) => {
        baseline = scanSources({
          root: candidateRoot,
          trustedRoot: candidateRoot,
          output: join(directory, "baseline"),
          scanner: resolve(process.env.OSV_SCANNER),
          now,
        });
        assert.deepEqual(baseline.errors, []);
        assert.ok(baseline.blocking.length > 0);
        // Fixture-only policy derives exact identities from this live database;
        // advisory additions/withdrawals do not freeze the test to today's IDs.
        const identities = new Map(
          baseline.blocking.map(({ advisory, package: pkg, context }) => [
            JSON.stringify([advisory, pkg, context]),
            { ...entry, advisory, package: pkg, context },
          ]),
        );
        return { schema_version: 1, exceptions: [...identities.values()] };
      },
    });
    const args = {
      root: w.candidateRoot,
      trustedRoot: w.trustedRoot,
      output: w.output,
      scanner: resolve(process.env.OSV_SCANNER),
      now,
    };
    assert.equal(scanSources(args).passed, false); // Ordinary mode still rejects policy inequality.
    const report = scanSources({
      ...args,
      publicationPolicy: w.receipt,
      environment: w.environment,
    });
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.deepEqual(report.errors, []);
    assert.equal(report.excepted.length, baseline.blocking.length);
    assert.deepEqual(report.blocking, []);
    assert.equal(report.policy_source.sha, w.policySha);
    assert.equal(git(w.candidateRoot, "rev-parse", "HEAD"), w.candidateSha);
  },
);
