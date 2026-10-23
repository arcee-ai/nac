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
];
export const context = "Required PR checks";
export const actionsApp = 15368;
export const codeowners = "* @allisoneer @Cecocho @ericlau98\n";

export function proposal() {
  return {
    name: "dev required CI and designated review",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/dev"], exclude: [] } },
    bypass_actors: [{ actor_id: 20910163, actor_type: "User", bypass_mode: "pull_request" }],
    rules: [
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: ["merge", "squash", "rebase"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [{ context, integration_id: actionsApp }],
        },
      },
    ],
  };
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
  const rulesets = pages(`${prefix}/rulesets?per_page=100`).map((item) =>
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
  "rust-pass",
  "web-pass",
  "workflow-pass",
  "docs-pass",
  "managed-pass",
  "api-drift-blocked",
  "assets-drift-blocked",
  "browser-failure-blocked",
  "image-failure-blocked",
  "failed-blocked",
  "pending-blocked",
  "cancelled-blocked",
  "missing-blocked",
  "stale-check-blocked",
  "unexpected-skip-blocked",
  "allison-approval",
  "aleksiej-approval",
  "eric-approval",
  "self-approval-blocked",
  "outside-only-blocked",
  "author-excluded-requests",
  "bot-owner-requests",
  "stale-review-dismissed",
  "unresolved-conversation-blocked",
  "two-layer-stack-base-codeowners",
  "allison-own-failed-pr-override",
  "allison-own-pending-pr-override",
  "ordinary-override-blocked",
  "automation-override-blocked",
  "direct-push-blocked",
  "inherited-protections-preserved",
];

export function validateQualification(receipt, now = Date.now()) {
  if (
    receipt.schema_version !== 1 ||
    receipt.kind !== "github-platform-qualification" ||
    receipt.fixture_repository === "arcee-ai/nac" ||
    !/^[\w.-]+\/[\w.-]+$/.test(receipt.fixture_repository ?? "") ||
    receipt.payload_sha256 !== digest(proposal())
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
  validateQualification(receipt, now);
  if (settingsIdentity(before) !== settingsIdentity(current))
    throw new Error("settings drift: review a fresh baseline");
  const age = now - Date.parse(current.captured_at);
  if (!(age >= 0 && age < 60 * 60 * 1000))
    throw new Error("refresh current settings within one hour");
  if (current.codeowners !== codeowners) throw new Error("CODEOWNERS has not landed on dev");
  const check = current.checks.find(
    (item) =>
      item.name === context &&
      item.app?.id === actionsApp &&
      item.head_sha === current.dev_sha &&
      item.status === "completed" &&
      item.conclusion === "success",
  );
  if (!check) throw new Error("required GitHub Actions context has not succeeded on current dev");
  if (current.rulesets.some((item) => item.name === proposal().name))
    throw new Error("existing target ruleset requires explicit reviewed update");
  return {
    repository: current.repository,
    dev_sha: current.dev_sha,
    baseline_sha256: settingsIdentity(current),
    qualification_sha256: digest(receipt),
    proposed_ruleset: proposal(),
    instruction:
      "Review this payload and inherited rules; a separately authorized human may create this additional ruleset. Capture after settings and compare. No mutation was performed.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
  if (command === "snapshot" && args.length === 2) {
    fs.writeFileSync(args[1], `${JSON.stringify(capture(args[0]), null, 2)}\n`, { flag: "wx" });
  } else if (command === "plan" && args.length === 1) {
    const baseline = read(args[0]);
    validateSnapshot(baseline);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run-only",
          baseline_sha256: settingsIdentity(baseline),
          preserved_rulesets: baseline.rulesets,
          proposed_additional_ruleset: proposal(),
          prerequisites: [
            "Merged contexts emitted successfully on current dev",
            "Current dev CODEOWNERS",
            "Complete safe-fixture platform matrix",
            "Fresh settings comparison",
            "Explicit human activation authorization",
          ],
        },
        null,
        2,
      ),
    );
  } else if (command === "activation-plan" && args.length === 2) {
    const before = read(args[0]);
    console.log(
      JSON.stringify(activationPlan(before, capture(before.repository), read(args[1])), null, 2),
    );
  } else {
    throw new Error(
      "usage: pr-ruleset.mjs snapshot <owner/repo> <new-file> | plan <before.json> | activation-plan <before.json> <qualification.json>; all commands are read-only",
    );
  }
}
