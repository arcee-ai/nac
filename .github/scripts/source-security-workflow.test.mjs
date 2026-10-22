import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { requireComplete, requiredJobs } from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Already in the locked release-tooling graph.
const workflow = (name) => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));

test("PR and exact tag candidate source scans are direct mandatory aggregate/publication dependencies", () => {
  const stable = workflow("stable-release");
  assert.equal(stable.jobs["source-security"].uses, "./.github/workflows/source-security.yml");
  assert.equal(
    stable.jobs["source-security"].with["candidate-sha"],
    "${{ needs.prepare.outputs.sha }}",
  );
  assert.equal(
    stable.jobs["source-security"].with["trusted-policy-sha"],
    "${{ needs.prepare.outputs.source_policy_sha }}",
  );
  assert.equal(
    stable.jobs["source-security"].with["policy-mode"],
    "${{ needs.prepare.outputs.source_policy_mode }}",
  );
  const selection = stable.jobs.prepare.steps.find((step) => step.id === "source-policy");
  assert.match(selection.run, /publication-policy\.mjs select/u);
  assert.equal(
    selection.env.CANDIDATE_SHA,
    "${{ steps.stable.outputs.sha || steps.ci.outputs.sha }}",
  );
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("source-security"));
  assert.ok(stable.jobs.publish.needs.includes("source-security"));
  const sha = "a".repeat(40);
  const needs = Object.fromEntries(requiredJobs.map((job) => [job, { result: "success" }]));
  needs.prepare.outputs = { sha, run: "true" };
  needs.managed = { result: "skipped" };
  requireComplete(needs, "false", sha);
  for (const result of ["failure", "skipped", "cancelled", "pending", undefined]) {
    needs["source-security"].result = result;
    assert.throws(() => requireComplete(needs, "false", sha));
  }
});

test("GitHub Release creation scans immutable merged SHA before minting a publication token", () => {
  const release = workflow("release-please").jobs;
  const scan = release["source-security"];
  assert.equal(scan.needs, "release-candidate");
  assert.equal(scan.uses, "./.github/workflows/source-security.yml");
  assert.equal(scan.with["candidate-sha"], "${{ needs.release-candidate.outputs.sha }}");
  assert.equal(scan.with["trusted-policy-sha"], undefined);
  assert.equal(scan.with["policy-mode"], "publication");
  assert.equal(
    release["release-candidate"].steps[0].env.MERGE_SHA,
    "${{ github.event.pull_request.merge_commit_sha }}",
  );
  const publish = release["publish-approved-release"];
  assert.deepEqual(publish.needs, ["release-candidate", "source-security"]);
  assert.equal(publish.steps[0].with.ref, scan.with["candidate-sha"]);
  assert.equal(publish.steps.at(-1).env.SCANNED_SHA, scan.with["candidate-sha"]);
  assert.equal(publish.steps.at(-1).run, "node .github/scripts/source-release.mjs");
  assert.ok(
    publish.steps.findIndex((step) => step.name?.startsWith("Verify release policy")) <
      publish.steps.findIndex((step) => step.name?.startsWith("Mint repository-scoped")),
  );
});

test("daily workflow binds current dev once and retains failing findings without claiming stale PR revocation", () => {
  const daily = workflow("source-security-daily");
  assert.equal(daily.jobs.candidate.steps[0].with.ref, "dev");
  assert.ok(daily.on.schedule[0].cron);
  assert.deepEqual(daily.jobs.scan.with, {
    "candidate-sha": "${{ needs.candidate.outputs.sha }}",
    "trusted-policy-sha": "${{ needs.candidate.outputs.sha }}",
  });
  const source = workflow("source-security").jobs.scan;
  assert.equal(source["continue-on-error"], undefined);
  assert.equal(
    source.steps.find((step) => step.with?.path === "trusted-policy").with.ref,
    "${{ steps.publication-policy.outputs.sha || inputs.trusted-policy-sha }}",
  );
  for (const step of source.steps) assert.equal(step["continue-on-error"], undefined);
  const report = source.steps.find(
    (step) => step.name === "Retain concise findings in the run summary",
  );
  assert.equal(report.if, "always()");
  assert.equal(source.steps.at(-1).if, "always()");
});

test("publication resolves and pins canonical policy before checkout without caller-selected revisions", () => {
  const source = workflow("source-security");
  assert.equal(source.on.workflow_call.inputs["policy-mode"].default, "ordinary");
  const steps = source.jobs.scan.steps;
  const resolver = steps.find((step) => step.id === "publication-policy");
  assert.equal(resolver.if, "inputs.policy-mode == 'publication'");
  assert.match(resolver.run, /publication-policy\.mjs resolve/u);
  assert.equal(resolver.env.REQUESTED_POLICY_SHA, "${{ inputs.trusted-policy-sha }}");
  assert.ok(
    steps.indexOf(resolver) < steps.findIndex((step) => step.with?.path === "trusted-policy"),
  );
  const checkout = steps.find((step) => step.with?.path === "trusted-policy");
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.equal(checkout.with["persist-credentials"], false);
  const scan = steps.find((step) => step.env?.NAC_PUBLICATION_POLICY_SHA);
  assert.equal(scan.env.NAC_PUBLICATION_POLICY_SHA, "${{ steps.publication-policy.outputs.sha }}");
  assert.match(scan.run, /--publication-policy/u);
  assert.match(steps[0].run, /publication\) test -z "\$POLICY_SHA"/u);
  assert.equal(source.permissions.contents, "read");
});
