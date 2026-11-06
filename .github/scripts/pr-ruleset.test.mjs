import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  activationPlan, actionsApp, codeowners, context, digest, dryRunPlan, proposal,
  qualificationCases, requiredCheckRule, reviewRuleset, settingsIdentity, targetRuleset,
  validateQualification, validateSnapshot, verifyReadback,
} from "./pr-ruleset.mjs";

// Exact rulesets read back November 3 at 20:33:38 UTC. Remaining snapshot
// fields come from October evidence: this combined model is NOT a live capture.
const historical = JSON.parse(fs.readFileSync(new URL(
  "../../docs/ci/evidence/2026-10-30-required-check-before-nine-owners.json", import.meta.url), "utf8"));
const observedRulesets = JSON.parse(fs.readFileSync(new URL(
  "../../docs/ci/evidence/2026-11-03-review-exemption-rulesets.json", import.meta.url), "utf8"));
const observed = { ...structuredClone(historical), rulesets: observedRulesets };
const now = Date.parse(observed.captured_at);
// Synthetic current settings, passing checks, and landed CODEOWNERS test the
// guards only. No full refreshed baseline or platform qualification is claimed.
const snapshot = () => {
  const result = structuredClone(observed);
  result.codeowners = codeowners;
  result.effective_dev_rules = observedRulesets.flatMap((ruleset) =>
    ruleset.target === "branch" ? ruleset.rules.map((rule) => ({ ...structuredClone(rule),
      ruleset_id: ruleset.id, ruleset_source_type: ruleset.source_type,
      ruleset_source: ruleset.source })) : []);
  result.checks = [{ id: 100, name: context, head_sha: result.dev_sha,
    app: { id: actionsApp }, status: "completed", conclusion: "success" }];
  return result;
};
const universal = (s) => s.rulesets.find(({ id }) => id === targetRuleset);
const reviews = (s) => s.rulesets.find(({ id }) => id === reviewRuleset);
// Synthetic receipts only test rejection/structure. Never platform qualification.
const receipt = () => ({
  schema_version: 1, kind: "github-platform-qualification",
  fixture_repository: "fixture/qualification",
  baseline_sha256: settingsIdentity(snapshot()),
  payload_sha256: digest(proposal(snapshot())),
  completed_at: new Date(now).toISOString(),
  cases: qualificationCases.map((name) => ({ name, result: "passed", actor_id: name.startsWith("allisoneer-") ? 20910163 : 123,
    head_sha: observed.dev_sha, evidence_url: "https://github.com/fixture/qualification/pull/1" })),
});
const afterSnapshot = () => {
  const after = snapshot();
  Object.assign(after.rulesets.find((item) => item.id === targetRuleset), proposal(snapshot()));
  after.effective_dev_rules.push({ ...requiredCheckRule(), ruleset_id: targetRuleset,
    ruleset_source_type: "Repository", ruleset_source: after.repository });
  return after;
};

test("plan adds only strict exact Actions checks to the observed current ruleset", () => {
  const before = structuredClone(observed);
  const old = structuredClone(before);
  const payload = proposal(before);
  const current = before.rulesets.find((item) => item.id === targetRuleset);
  assert.deepEqual(payload.rules.slice(0, -1), current.rules);
  assert.deepEqual(payload.rules.at(-1), requiredCheckRule());
  for (const key of ["name", "target", "enforcement", "conditions", "bypass_actors"])
    assert.deepEqual(payload[key], current[key]);
  assert.deepEqual(payload.bypass_actors, []);
  assert.deepEqual(payload.conditions.ref_name, { include: ["~DEFAULT_BRANCH"], exclude: [] });
  const review = payload.rules.find((rule) => rule.type === "pull_request").parameters;
  assert.equal(review.required_approving_review_count, 0);
  assert.equal(review.dismiss_stale_reviews_on_push, false);
  assert.equal(review.required_review_thread_resolution, true);
  for (const key of ["require_code_owner_review", "require_last_push_approval",
    "require_extra_approval_for_unattributed_changes"])
    assert.equal(review[key], false);
  assert.deepEqual(reviews(before), reviews(old), "review-only exception is untouched");
  assert.deepEqual(payload.rules.at(-1).parameters, {
    strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
    required_status_checks: [{ context: "Required PR checks", integration_id: 15368 }],
  });
  assert.deepEqual(before, old, "planning must never mutate the input snapshot");
  const plan = dryRunPlan(before);
  assert.equal(plan.ruleset_id, 25983949);
  assert.deepEqual(plan.proposed_ruleset, payload);
  assert.equal(plan.proposed_sha256, digest(payload));
});

test("split policy rejects wrong, broad or extra actors, modes, moved rules and weakened reviews", () => {
  const mutations = [
    (s) => { reviews(s).bypass_actors[0].actor_id = 365659; },
    (s) => { reviews(s).bypass_actors[0].actor_type = "Team"; },
    (s) => { reviews(s).bypass_actors[0].actor_type = "RepositoryRole"; },
    (s) => { reviews(s).bypass_actors[0].bypass_mode = "always"; },
    (s) => { reviews(s).bypass_actors.push({ actor_id: 1, actor_type: "User", bypass_mode: "pull_request" }); },
    (s) => { reviews(s).bypass_actors = []; },
    (s) => { universal(s).bypass_actors = structuredClone(reviews(s).bypass_actors); },
    (s) => { s.rulesets = s.rulesets.filter(({ id }) => id !== reviewRuleset); },
    (s) => { s.rulesets = s.rulesets.filter(({ id }) => id !== targetRuleset); },
    (s) => { s.rulesets.push(structuredClone(reviews(s))); },
    (s) => { reviews(s).enforcement = "disabled"; },
    (s) => { reviews(s).source_type = "Enterprise"; },
    (s) => { reviews(s).conditions.ref_name.include = ["refs/heads/dev"]; },
    (s) => { reviews(s).rules.push(requiredCheckRule()); },
    (s) => { universal(s).rules = universal(s).rules.filter(({ type }) => type !== "pull_request"); },
    (s) => { universal(s).rules = universal(s).rules.filter(({ type }) => type !== "deletion"); },
    (s) => { universal(s).rules = universal(s).rules.filter(({ type }) => type !== "non_fast_forward"); },
    (s) => { universal(s).rules.find(({ type }) => type === "pull_request").parameters.required_review_thread_resolution = false; },
    (s) => { const rule = universal(s).rules.pop(); reviews(s).rules.push(rule); },
  ];
  for (const key of ["require_code_owner_review", "require_last_push_approval",
    "required_review_thread_resolution", "require_extra_approval_for_unattributed_changes"]) {
    mutations.push((s) => { reviews(s).rules[0].parameters[key] = false; });
  }
  mutations.push(
    (s) => { reviews(s).rules[0].parameters.required_approving_review_count = 0; },
    (s) => { reviews(s).rules[0].parameters.allowed_merge_methods = ["squash"]; },
    (s) => { reviews(s).rules[0].parameters.dismissal_restriction.enabled = true; },
    (s) => { reviews(s).rules[0].parameters.required_reviewers = [{ id: 1 }]; },
    (s) => { delete reviews(s).rules[0].parameters; },
  );
  for (const mutate of mutations) {
    const changed = snapshot(); mutate(changed);
    assert.throws(() => proposal(changed), /ruleset|protections/, mutate.toString());
    assert.throws(() => activationPlan(snapshot(), changed, receipt(), now), undefined, mutate.toString());
    const after = afterSnapshot(); mutate(after);
    assert.throws(() => verifyReadback(snapshot(), after, now), /readback/, mutate.toString());
  }
});

test("qualification distinguishes Allison's human exception from ordinary actors", () => {
  for (const name of qualificationCases.filter((name) => name.startsWith("allisoneer-"))) {
    const changed = receipt(); changed.cases.find((item) => item.name === name).actor_id = 123;
    assert.throws(() => validateQualification(changed, snapshot(), now), /real GitHub evidence/);
  }
  for (const name of qualificationCases.filter((name) => name.startsWith("ordinary-"))) {
    const changed = receipt(); changed.cases.find((item) => item.name === name).actor_id = 20910163;
    assert.throws(() => validateQualification(changed, snapshot(), now), /real GitHub evidence/);
  }
});

test("observed eight-owner and historical six-owner CODEOWNERS cannot activate the nine-owner plan", () => {
  const prelanding = JSON.parse(fs.readFileSync(new URL(
    "../../docs/ci/evidence/2026-10-30-required-check-before-eight-owners.json", import.meta.url), "utf8"));
  assert.equal(prelanding.codeowners.includes("@adalundhe"), false);
  assert.equal(prelanding.codeowners.includes("@ScottZembsch"), false);
  assert.equal(observed.codeowners.includes("@Crystalcareai"), false);
  // Even a synthetic passing check and complete receipt cannot replace landed
  // CODEOWNERS; no observed data is rewritten to manufacture activation.
  for (const codeowners of [observed.codeowners, prelanding.codeowners]) {
    const current = snapshot();
    current.codeowners = codeowners;
    assert.throws(() => activationPlan(snapshot(), current, receipt(), now), /CODEOWNERS has not landed/);
  }
  assert.equal(snapshot().codeowners, codeowners);
});

test("readback verifies exactly the addition and returns a guarded original rollback payload", () => {
  const after = afterSnapshot();
  // Server-generated timestamps may change; settings/rules must remain equal.
  after.rulesets.find((item) => item.id === targetRuleset).updated_at = "later";
  after.rulesets.find((item) => item.id === targetRuleset).rules.reverse();
  after.rulesets.reverse(); after.effective_dev_rules.reverse();
  const result = verifyReadback(snapshot(), after, now);
  assert.equal(result.verified, true);
  assert.deepEqual(result.rollback_ruleset, dryRunPlan(snapshot()).before_ruleset);
  assert.ok(!result.rollback_ruleset.rules.some((rule) => rule.type === "required_status_checks"));
  for (const mutate of [
    (s) => { s.rulesets[0].rules = []; },
    (s) => { s.effective_dev_rules.pop(); },
    (s) => { s.rulesets.find((r) => r.id === targetRuleset).bypass_actors.push({ actor_id: 20910163 }); },
    (s) => { s.rulesets.find((r) => r.id === targetRuleset).rules[2].parameters.require_last_push_approval = true; },
    (s) => { s.rulesets.find((r) => r.id === targetRuleset).rules.at(-1).parameters.strict_required_status_checks_policy = false; },
    (s) => { s.classic_protection = {}; },
    (s) => { s.merge_methods.squash_merge = false; },
    (s) => { s.codeowners = "* @someone\n"; },
  ]) {
    const changed = afterSnapshot(); mutate(changed);
    assert.throws(() => verifyReadback(snapshot(), changed, now), /readback/);
  }
});

test("old, future or malformed readback cannot produce a rollback payload", () => {
  for (const captured of [new Date(now - 3600000).toISOString(), new Date(now + 1).toISOString(), "invalid"]) {
    const after = afterSnapshot(); after.captured_at = captured;
    assert.throws(() => verifyReadback(snapshot(), after, now), /refresh observed readback/);
  }
});

test("activation refuses drift in any review, inherited, bypass, branch or repository setting", () => {
  assert.equal(activationPlan(snapshot(), snapshot(), receipt(), now).dev_sha, observed.dev_sha);
  for (const mutate of [
    (s) => { s.rulesets = []; },
    (s) => { s.effective_dev_rules = []; },
    (s) => { s.classic_protection = {}; },
    (s) => { s.owners[0].permission = "read"; },
    (s) => { s.merge_methods.merge_commit = false; },
    (s) => { s.default_branch = "main"; },
    (s) => { s.codeowners = "* @someone\n"; },
    (s) => { s.captured_at = new Date(now - 3600000).toISOString(); },
    (s) => { reviews(s).rules[0].parameters.require_extra_approval_for_unattributed_changes = false; },
    (s) => { universal(s).bypass_actors.push({ actor_id: 20910163 }); },
    (s) => { universal(s).conditions.ref_name.include = ["refs/heads/dev"]; },
  ]) {
    const changed = snapshot(); mutate(changed);
    assert.throws(() => activationPlan(snapshot(), changed, receipt(), now));
  }
  const already = snapshot(); universal(already).rules.push(requiredCheckRule());
  assert.throws(() => proposal(already), /already/);
});

test("newest current-head exact-App check must succeed; old success never masks a replacement", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", "neutral", "timed_out", null]) {
    const current = snapshot(); current.checks[0].conclusion = conclusion;
    assert.throws(() => activationPlan(snapshot(), current, receipt(), now), /context/);
  }
  for (const mutate of [
    (s) => { s.checks = []; },
    (s) => { s.checks[0].head_sha = "b".repeat(40); },
    (s) => { s.checks[0].app.id = 1; },
    (s) => { s.checks[0].status = "in_progress"; },
    (s) => { delete s.checks[0].id; },
    (s) => { s.checks.push({ ...s.checks[0], id: 101, conclusion: "failure" }); },
    (s) => { s.checks.push({ ...s.checks[0], id: 101, status: "queued", conclusion: null }); },
    (s) => { s.dev_sha = "b".repeat(40); },
  ]) {
    const current = snapshot(); mutate(current);
    assert.throws(() => activationPlan(snapshot(), current, receipt(), now));
  }
});

test("model tests, stale/foreign/incomplete receipts and old override payload cannot qualify activation", () => {
  validateQualification(receipt(), snapshot(), now);
  for (const mutate of [
    (r) => { r.kind = "local-model-test"; },
    (r) => { r.fixture_repository = "arcee-ai/nac"; },
    (r) => { r.payload_sha256 = "old ALL450 proposal"; },
    (r) => { r.baseline_sha256 = "drift"; },
    (r) => { r.completed_at = new Date(now - 8 * 86400000).toISOString(); },
    (r) => { r.completed_at = "invalid"; },
    (r) => { r.cases.pop(); },
    (r) => { r.cases[0].result = "pending"; },
    (r) => { r.cases[0].actor_id = null; },
    (r) => { r.cases[0].evidence_url = "https://github.com/unrelated/repo/pull/1"; },
    (r) => { r.cases[0].head_sha = "old"; },
    (r) => { r.cases[0].name = r.cases[1].name; },
  ]) {
    const changed = receipt(); mutate(changed);
    assert.throws(() => validateQualification(changed, snapshot(), now));
  }
  const wrong = snapshot(); wrong.owners[0].id = 999;
  assert.throws(() => validateSnapshot(wrong));
  for (const name of ["ordinary-last-push-self-approval-blocked", "ordinary-unattributed-extra-approval-required",
    "wrong-app-blocked", "two-layer-stack-base-codeowners", "strict-image-baseline-qualified"])
    assert.ok(qualificationCases.includes(name));
  assert.ok(!qualificationCases.some((name) => name.includes("own-failed-pr-override")));
  assert.deepEqual(qualificationCases.filter((name) => name.endsWith("-approval")),
    observed.owners.map(({ login }) => `${login}-approval`));
});

test("historical handoff template cannot certify the new split or unperformed platform work", () => {
  const plan = JSON.parse(fs.readFileSync(new URL(
    "../../docs/ci/evidence/2026-10-30-required-check-plan-nine-owners.json", import.meta.url), "utf8"));
  // The old plan and template remain historical; neither qualifies this split.
  assert.equal(plan.baseline_sha256, settingsIdentity(historical));
  assert.throws(() => dryRunPlan(historical), /ruleset|protections/);
  const template = JSON.parse(fs.readFileSync(new URL(
    "../../docs/ci/evidence/qualification-template.json", import.meta.url), "utf8"));
  assert.notEqual(template.payload_sha256, digest(proposal(snapshot())));
  assert.notEqual(template.baseline_sha256, settingsIdentity(snapshot()));
  assert.ok(!template.cases.some((item) => item.name === "allisoneer-review-approval-bypass"));
  assert.ok(template.cases.every((item) => item.result === "unperformed"));
  assert.throws(() => validateQualification(template, snapshot(), now));
  const guide = fs.readFileSync(new URL("../../docs/ci/required-pr-checks.md", import.meta.url), "utf8");
  assert.match(guide, /does \*\*not\*\* inherit its required checks or review rules/);
  assert.match(guide, /retarget the upper PR to `dev`/);
});

test("nine-owner baseline cannot reuse historical three-, six-, seven- or eight-owner evidence", () => {
  for (const name of ["2026-10-27-required-check-before.json", "2026-10-27-required-check-before-six-owners.json",
    "2026-10-30-required-check-before-seven-owners.json", "2026-10-30-required-check-before-eight-owners.json",
    "2026-10-30-required-check-before-eight-owners-landed.json"]) {
    const historical = JSON.parse(fs.readFileSync(new URL(
      `../../docs/ci/evidence/${name}`, import.meta.url), "utf8"));
    assert.throws(() => dryRunPlan(historical), /lacks verified write access/);
  }
});

for (const owner of [
  { login: "adalundhe", id: 23642200, permission: "write" },
  { login: "ScottZembsch", id: 109129358, permission: "write" },
  { login: "Crystalcareai", id: 162942000, permission: "admin" },
]) {
  test(`${owner.login} must retain verified identity and write access in the nine-owner baseline`, () => {
    assert.deepEqual(observed.owners.find(({ login }) => login === owner.login),
      owner);
    for (const mutate of [
      (s) => { s.owners = s.owners.filter(({ login }) => login !== owner.login); },
      (s) => { s.owners.find(({ login }) => login === owner.login).permission = "read"; },
      (s) => { s.owners.find(({ login }) => login === owner.login).id = 1; },
    ]) {
      const current = snapshot(); mutate(current);
      assert.throws(() => validateSnapshot(current), new RegExp(`owner ${owner.login} lacks verified write access`));
    }
  });
}
