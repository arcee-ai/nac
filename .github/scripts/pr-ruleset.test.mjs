import assert from "node:assert/strict";
import test from "node:test";
import {
  activationPlan,
  actionsApp,
  codeowners,
  context,
  digest,
  owners,
  proposal,
  qualificationCases,
  settingsIdentity,
  validateQualification,
  validateSnapshot,
} from "./pr-ruleset.mjs";

const now = Date.parse("2026-10-21T22:00:00Z");
const sha = "a".repeat(40);
const snapshot = () => ({
  schema_version: 1,
  captured_at: new Date(now).toISOString(),
  repository: "arcee-ai/nac",
  default_branch: "dev",
  dev_sha: sha,
  merge_methods: {},
  owners: owners.map((owner) => ({ ...owner, permission: "write" })),
  codeowners,
  rulesets: [{ id: 1, source_type: "Enterprise", rules: [{ type: "non_fast_forward" }] }],
  effective_dev_rules: [{ type: "non_fast_forward" }],
  classic_protection: null,
  checks: [
    {
      name: context,
      head_sha: sha,
      app: { id: actionsApp },
      status: "completed",
      conclusion: "success",
    },
  ],
});
const receipt = () => ({
  schema_version: 1,
  kind: "github-platform-qualification",
  fixture_repository: "fixture/qualification",
  payload_sha256: digest(proposal()),
  completed_at: new Date(now).toISOString(),
  cases: qualificationCases.map((name) => ({
    name,
    result: "passed",
    actor_id: 123,
    head_sha: sha,
    evidence_url: "https://github.com/fixture/qualification/pull/1",
  })),
});

test("exact additional ruleset requires designated review/current Actions result and only Allison PR bypass", () => {
  const payload = proposal();
  assert.equal(payload.enforcement, "active");
  assert.deepEqual(payload.conditions.ref_name, { include: ["refs/heads/dev"], exclude: [] });
  assert.deepEqual(payload.bypass_actors, [
    { actor_id: 20910163, actor_type: "User", bypass_mode: "pull_request" },
  ]);
  const review = payload.rules.find((rule) => rule.type === "pull_request").parameters;
  assert.equal(review.required_approving_review_count, 1);
  for (const field of [
    "require_code_owner_review",
    "dismiss_stale_reviews_on_push",
    "required_review_thread_resolution",
  ]) {
    assert.equal(review[field], true);
  }
  const checks = payload.rules.find((rule) => rule.type === "required_status_checks").parameters;
  assert.equal(checks.strict_required_status_checks_policy, true);
  assert.equal(checks.do_not_enforce_on_create, false);
  assert.deepEqual(checks.required_status_checks, [{ context, integration_id: actionsApp }]);
});

test("read-only activation plan preserves every inherited rule and refuses premature or drifted rollout", () => {
  const before = snapshot();
  const current = snapshot();
  const qualified = receipt();
  assert.equal(activationPlan(before, current, qualified, now).dev_sha, sha);
  assert.equal(
    settingsIdentity(before),
    settingsIdentity({ ...before, dev_sha: "b".repeat(40), checks: [] }),
  );
  for (const mutate of [
    (s) => {
      s.rulesets = [];
    },
    (s) => {
      s.effective_dev_rules = [];
    },
    (s) => {
      s.classic_protection = { required_status_checks: {} };
    },
    (s) => {
      s.owners[0].permission = "read";
    },
    (s) => {
      s.codeowners = "* @someone\n";
    },
    (s) => {
      s.captured_at = "2026-10-20T22:00:00Z";
    },
    (s) => {
      s.checks = [];
    },
    (s) => {
      s.checks[0].head_sha = "b".repeat(40);
    },
    (s) => {
      s.checks[0].app.id = 1;
    },
    (s) => {
      s.checks[0].conclusion = "failure";
    },
    (s) => {
      s.checks[0].status = "in_progress";
    },
  ]) {
    const changed = structuredClone(current);
    mutate(changed);
    assert.throws(() => activationPlan(before, changed, qualified, now));
  }
});

test("local model tests, incomplete/expired receipts and foreign evidence cannot qualify GitHub enforcement", () => {
  validateQualification(receipt(), now);
  for (const mutate of [
    (r) => {
      r.kind = "local-model-test";
    },
    (r) => {
      r.fixture_repository = "arcee-ai/nac";
    },
    (r) => {
      r.payload_sha256 = "wrong";
    },
    (r) => {
      r.completed_at = "2026-10-01T00:00:00Z";
    },
    (r) => {
      r.completed_at = "invalid";
    },
    (r) => {
      r.cases.pop();
    },
    (r) => {
      r.cases[0].result = "pending";
    },
    (r) => {
      r.cases[0].actor_id = null;
    },
    (r) => {
      r.cases[0].evidence_url = "https://github.com/unrelated/repo/pull/1";
    },
    (r) => {
      r.cases[0].head_sha = "old";
    },
    (r) => {
      r.cases[0].name = r.cases[1].name;
    },
  ]) {
    const changed = receipt();
    mutate(changed);
    assert.throws(() => validateQualification(changed, now));
  }
  const wrong = snapshot();
  wrong.owners[0].id = 999;
  assert.throws(() => validateSnapshot(wrong));
});
