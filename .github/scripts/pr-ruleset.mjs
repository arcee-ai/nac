// Read-only settings capture and guarded payload generation. This program never
// changes repository settings, merges a PR, or exercises bypass credentials.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const owners = [
  { login: "allisoneer", id: 20910163 },
  { login: "Cecocho", id: 105443339 },
  { login: "ericlau98", id: 17348362 },
  { login: "samantha662", id: 250395928 },
  { login: "gerred", id: 365659 },
  { login: "tmcarcee", id: 338224923 },
  { login: "adalundhe", id: 23642200 },
  { login: "ScottZembsch", id: 109129358 },
];
export const context = "Required PR checks";
export const actionsApp = 15368;
export const codeowners = `* ${owners.map(({ login }) => `@${login}`).join(" ")}\n`;

export const targetRuleset = 25983949;

export function requiredCheckRule() {
  return {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context, integration_id: actionsApp }],
    },
  };
}

function target(snapshot) {
  validateSnapshot(snapshot);
  const matches = snapshot.rulesets.filter((item) => item.id === targetRuleset);
  const current = matches[0];
  if (matches.length !== 1 || current.source_type !== "Repository" ||
      current.source !== snapshot.repository || current.target !== "branch" ||
      current.enforcement !== "active" ||
      digest(current.conditions) !== digest({ ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }) ||
      !Array.isArray(current.bypass_actors) || current.bypass_actors.length !== 0 ||
      !Array.isArray(current.rules)) {
    throw new Error("current target ruleset differs: rebaseline with human review");
  }
  const reviews = current.rules.filter((rule) => rule.type === "pull_request");
  const review = reviews[0]?.parameters;
  if (reviews.length !== 1 || review.required_approving_review_count < 1 ||
      !review.require_code_owner_review || !review.require_last_push_approval ||
      !review.required_review_thread_resolution || !review.require_extra_approval_for_unattributed_changes) {
    throw new Error("current review protections are missing");
  }
  return current;
}

function payload(ruleset) {
  return Object.fromEntries(["name", "target", "enforcement", "conditions", "bypass_actors", "rules"]
    .map((key) => [key, structuredClone(ruleset[key])]));
}

// All existing fields/rules remain byte-for-byte equivalent as JSON values.
// Never use the historical ALL-450 review/bypass proposal against current settings.
export function proposal(snapshot) {
  const current = target(snapshot);
  if (current.rules.some((rule) => rule.type === "required_status_checks")) {
    throw new Error("target already has status checks: review a fresh baseline");
  }
  const proposed = payload(current);
  proposed.rules.push(requiredCheckRule());
  return proposed;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
export function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function api(path, { optional404 = false } = {}) {
  try {
    return JSON.parse(
      execFileSync("gh", ["api", "--paginate", "--slurp", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    if (optional404 && error.stderr?.includes("(HTTP 404)")) return null;
    throw error;
  }
}
function one(path, options) {
  return api(path, options)?.[0] ?? null;
}
function pages(path) {
  return api(path).flat();
}

export function capture(repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("invalid repository");
  const prefix = `repos/${repository}`;
  const repositoryInfo = one(prefix);
  const branch = one(`${prefix}/branches/dev`);
  const rulesets = pages(`${prefix}/rulesets?includes_parents=true&per_page=100`).map((item) =>
    one(`${prefix}/rulesets/${item.id}`),
  );
  const ownerPermissions = owners.map(({ login }) =>
    one(`${prefix}/collaborators/${login}/permission`),
  );
  const contents = one(`${prefix}/contents/.github/CODEOWNERS?ref=${branch.commit.sha}`, {
    optional404: true,
  });
  return {
    schema_version: 1,
    captured_at: new Date().toISOString(),
    repository,
    default_branch: repositoryInfo.default_branch,
    dev_sha: branch.commit.sha,
    merge_methods: Object.fromEntries(
      ["merge_commit", "squash_merge", "rebase_merge"].map((method) => [
        method,
        repositoryInfo[`allow_${method}`],
      ]),
    ),
    rulesets,
    effective_dev_rules: pages(`${prefix}/rules/branches/dev?per_page=100`),
    classic_protection: one(`${prefix}/branches/dev/protection`, { optional404: true }),
    owners: ownerPermissions.map((item) => ({
      login: item.user.login,
      id: item.user.id,
      permission: item.permission,
    })),
    codeowners: contents ? Buffer.from(contents.content, "base64").toString("utf8") : null,
    checks: pages(`${prefix}/commits/${branch.commit.sha}/check-runs?per_page=100`)
      .flatMap((page) => page.check_runs)
      .map((item) => ({
        id: item.id,
        name: item.name,
        head_sha: item.head_sha,
        status: item.status,
        conclusion: item.conclusion,
        html_url: item.html_url,
        app: { id: item.app.id, slug: item.app.slug },
      })),
  };
}

export function validateSnapshot(snapshot) {
  if (
    snapshot.schema_version !== 1 ||
    snapshot.repository !== "arcee-ai/nac" ||
    snapshot.default_branch !== "dev"
  ) {
    throw new Error("snapshot is not the intended NAC dev repository");
  }
  if (!/^[a-f0-9]{40}$/.test(snapshot.dev_sha)) throw new Error("invalid dev revision");
  for (const owner of owners) {
    const actual = snapshot.owners.find(
      (item) => item.id === owner.id && item.login === owner.login,
    );
    if (!actual || !["write", "maintain", "admin"].includes(actual.permission)) {
      throw new Error(`owner ${owner.login} lacks verified write access`);
    }
  }
  for (const field of ["rulesets", "effective_dev_rules", "checks"]) {
    if (!Array.isArray(snapshot[field])) throw new Error(`missing ${field}`);
  }
}

// Excludes volatile run/head data; protects every existing rule and bypass list.
export function settingsIdentity(snapshot) {
  return digest({
    repository: snapshot.repository,
    default_branch: snapshot.default_branch,
    merge_methods: snapshot.merge_methods,
    rulesets: snapshot.rulesets,
    effective_dev_rules: snapshot.effective_dev_rules,
    classic_protection: snapshot.classic_protection,
    owners: snapshot.owners,
  });
}

export const qualificationCases = [
  "rust-pass", "web-pass", "workflow-pass", "docs-pass", "managed-pass",
  "api-drift-blocked", "assets-drift-blocked", "browser-failure-blocked",
  "image-failure-blocked", "image-unknown-blocked", "strict-image-baseline-qualified",
  "failed-blocked", "pending-blocked", "cancelled-blocked", "missing-blocked",
  "stale-check-blocked", "wrong-app-blocked", "unexpected-skip-blocked",
  ...owners.map(({ login }) => `${login}-approval`), "self-approval-blocked",
  "outside-only-blocked", "author-excluded-requests", "bot-owner-requests",
  "last-push-self-approval-blocked", "unattributed-extra-approval-required",
  "unresolved-conversation-blocked", "two-layer-stack-base-codeowners",
  "ordinary-bypass-blocked", "automation-bypass-blocked", "direct-push-blocked",
  "inherited-protections-preserved",
];

export function validateQualification(receipt, baseline, now = Date.now()) {
  if (
    receipt.schema_version !== 1 ||
    receipt.kind !== "github-platform-qualification" ||
    receipt.fixture_repository === "arcee-ai/nac" ||
    !/^[\w.-]+\/[\w.-]+$/.test(receipt.fixture_repository ?? "") ||
    receipt.payload_sha256 !== digest(proposal(baseline)) ||
    receipt.baseline_sha256 !== settingsIdentity(baseline)
  )
    throw new Error("qualification identity/payload mismatch");
  const age = now - Date.parse(receipt.completed_at);
  if (!(age >= 0 && age <= 7 * 24 * 60 * 60 * 1000))
    throw new Error("qualification must be completed within seven days");
  if (receipt.cases?.length !== qualificationCases.length)
    throw new Error("incomplete fixture matrix");
  for (const name of qualificationCases) {
    const cases = receipt.cases.filter((item) => item.name === name);
    const item = cases[0];
    if (
      cases.length !== 1 ||
      item.result !== "passed" ||
      !Number.isSafeInteger(item.actor_id) ||
      !/^[a-f0-9]{40}$/.test(item.head_sha ?? "") ||
      !item.evidence_url?.startsWith(`https://github.com/${receipt.fixture_repository}/`)
    ) {
      throw new Error(`missing real GitHub evidence: ${name}`);
    }
  }
}

export function activationPlan(before, current, receipt, now = Date.now()) {
  validateSnapshot(before);
  validateSnapshot(current);
  validateQualification(receipt, before, now);
  if (settingsIdentity(before) !== settingsIdentity(current))
    throw new Error("settings drift: review a fresh baseline");
  const age = now - Date.parse(current.captured_at);
  if (!(age >= 0 && age < 60 * 60 * 1000))
    throw new Error("refresh current settings within one hour");
  if (current.codeowners !== codeowners) throw new Error("CODEOWNERS has not landed on dev");
  // The newest Actions run wins. A previous successful attempt cannot hide a
  // pending, cancelled or failed replacement on the same head.
  const checks = current.checks.filter((item) => item.name === context && item.app?.id === actionsApp);
  if (checks.some((item) => !Number.isSafeInteger(item.id) || item.id < 1))
    throw new Error("missing check-run identity");
  const check = checks.sort((a, b) => b.id - a.id)[0];
  if (!check || check.head_sha !== current.dev_sha || check.status !== "completed" ||
      check.conclusion !== "success")
    throw new Error("newest required Actions context has not succeeded on current dev");
  const plan = dryRunPlan(before);
  return {
    ...plan,
    dev_sha: current.dev_sha,
    qualification_sha256: digest(receipt),
    activation: "separate human authorization required; no mutation performed",
  };
}

export function dryRunPlan(before) {
  const proposed = proposal(before);
  return {
    mode: "dry-run-only",
    repository: before.repository,
    ruleset_id: targetRuleset,
    baseline_sha256: settingsIdentity(before),
    before_ruleset: payload(target(before)),
    proposed_ruleset: proposed,
    proposed_sha256: digest(proposed),
    prerequisites: [
      "ALL-505 fresh complete strict combined-image and unchanged-image qualification",
      "Complete real safe-repository actor/stack matrix bound to this payload and baseline",
      "Landed CODEOWNERS and newest successful exact Actions context on current dev",
      "Fresh full settings comparison immediately before application; abort on drift",
      "Explicit human activation authorization; no policy or bypass override",
    ],
  };
}

function rulesetIdentity(item) {
  const result = { id: item.id, source_type: item.source_type, source: item.source, ...payload(item) };
  // GitHub/UI may reorder rules; preserve exact rule values and multiplicity.
  result.rules = [...result.rules].sort((a, b) => digest(a).localeCompare(digest(b)));
  return result;
}

// Verify actual observed readback separately from the intended payload. This is
// also the precondition for rolling back only our added rule, never later edits.
export function verifyReadback(before, after, now = Date.now()) {
  validateSnapshot(before);
  validateSnapshot(after);
  const age = now - Date.parse(after.captured_at);
  if (!(age >= 0 && age < 60 * 60 * 1000))
    throw new Error("refresh observed readback within one hour before requesting rollback");
  const proposed = proposal(before);
  const expectedRules = [...before.effective_dev_rules, {
    ...requiredCheckRule(), ruleset_id: targetRuleset,
    ruleset_source_type: "Repository", ruleset_source: before.repository,
  }];
  const expected = before.rulesets.map((item) => item.id === targetRuleset
    ? rulesetIdentity({ ...item, ...proposed }) : rulesetIdentity(item));
  const order = (items) => items.map((item) => digest(item)).sort();
  if (digest(order(after.rulesets.map(rulesetIdentity))) !== digest(order(expected)) ||
      digest(order(after.effective_dev_rules)) !== digest(order(expectedRules)) ||
      digest(after.classic_protection) !== digest(before.classic_protection) ||
      digest(after.merge_methods) !== digest(before.merge_methods) ||
      digest(after.owners) !== digest(before.owners) || after.codeowners !== before.codeowners ||
      after.default_branch !== before.default_branch) {
    throw new Error("readback differs from the exact additive plan; do not roll back over drift");
  }
  return { verified: true, ruleset_id: targetRuleset, proposed_sha256: digest(proposed),
    rollback_ruleset: payload(target(before)), instruction: "Rollback also requires separate human authorization and a fresh matching readback." };

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
  if (command === "snapshot" && args.length === 2) {
    fs.writeFileSync(args[1], `${JSON.stringify(capture(args[0]), null, 2)}\n`, { flag: "wx" });
  } else if (command === "plan" && args.length === 1) {
    const baseline = read(args[0]);
    console.log(JSON.stringify(dryRunPlan(baseline), null, 2));
  } else if (command === "activation-plan" && args.length === 2) {
    const before = read(args[0]);
    console.log(
      JSON.stringify(activationPlan(before, capture(before.repository), read(args[1])), null, 2),
    );
  } else if (command === "verify-readback" && args.length === 2) {
    console.log(JSON.stringify(verifyReadback(read(args[0]), read(args[1])), null, 2));
  } else {
    throw new Error(
      "usage: pr-ruleset.mjs snapshot <owner/repo> <new-file> | plan <before.json> | activation-plan <before.json> <qualification.json> | verify-readback <before.json> <after.json>; all commands are read-only",
    );
  }
}
