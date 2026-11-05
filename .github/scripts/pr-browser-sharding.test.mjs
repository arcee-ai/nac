import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { requiredJobs, managedCallerJobs, requireComplete } from "./pr-checks.mjs";

const YAML = createRequire(import.meta.url)("yaml");
const workflow = YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));

test("every file-isolated browser shard executes the inventoried exclusion and partition", () => {
  const job = workflow.jobs["browser-shards"];
  assert.equal(job.needs, "prepare");
  assert.deepEqual(job.strategy, { "fail-fast": false, matrix: { shard: [1, 2, 3, 4] } });
  assert.equal(job.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  const execute = job.steps.find(step => step.name === "Run production-embedded browser shard");
  assert.equal(execute.env.BROWSER_SHARD, "${{ matrix.shard }}");
  assert.match(execute.run, /run test:e2e -- --grep-invert='exact-goal-wait.e2e.ts' --shard="\$BROWSER_SHARD\/4"/);
  assert.doesNotMatch(execute.run, /--workers|--retries|--fully-parallel/);
  const proof = workflow.jobs["browser-proof"];
  assert.equal(proof.needs, "prepare");
  assert.equal(proof.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  const select = proof.steps.find(step => step.name === "Verify complete disjoint current browser selection");
  assert.match(select.run, /for shard in 1 2 3 4;/);
  assert.match(select.run, /--grep-invert='exact-goal-wait.e2e.ts' --shard="\$shard\/4" --list --reporter=json/);
  assert.match(select.run, /playwright test --list --reporter=json/);
  assert.match(select.run, /playwright test exact-goal-wait.e2e.ts --list --reporter=json/);
  assert.match(select.run, /browser-inventory.py/);
  for (const part of ["proof", "ordinary-1", "ordinary-2", "ordinary-3", "ordinary-4"]) {
    assert.ok(select.run.includes(`--part browser-inventory/${part}.json`));
  }
  const run = proof.steps.find(step => step.name === "Run production-embedded goal proof journeys");
  assert.match(run.run, /run test:e2e -- exact-goal-wait.e2e.ts\s*$/);
  const stage = proof.steps.find(step => step.name === "Stage only the two bounded ALL471 goal receipts");
  assert.equal(stage.if, "always()");
  assert.equal(stage.env.GOAL_PROOF_SOURCE, "${{ needs.prepare.outputs.sha }}");
  assert.match(stage.run, /browser-proof.py.*--source "\$GOAL_PROOF_SOURCE"/);
  const artifact = proof.steps.find(step => step.name === "Retain only ALL471 goal proof and cleanup receipts");
  assert.equal(artifact.with.path, "crates/nac-server/web/test-results/all471-goal-proof-artifact/*.json");
  assert.equal(artifact.with["if-no-files-found"], "error");
  for (const item of [job, proof]) for (const step of item.steps) assert.equal(step["continue-on-error"], undefined);
});

test("browser compatibility join and final gate reject every incomplete shard/proof result", () => {
  const browser = workflow.jobs.browser;
  assert.deepEqual(browser.needs, ["prepare", "browser-shards", "browser-proof"]);
  assert.match(browser.if, /always\(\)/);
  const gate = browser.steps[0];
  assert.equal(gate.env.SHARD_RESULT, "${{ needs.browser-shards.result }}");
  assert.equal(gate.env.PROOF_RESULT, "${{ needs.browser-proof.result }}");
  for (const lane of ["browser-shards", "browser-proof"]) {
    assert.ok(requiredJobs.includes(lane));
    assert.ok(workflow.jobs["required-pr-checks"].needs.includes(lane));
  }
  const sha = "a".repeat(40);
  for (const result of ["success", "failure", "cancelled", "skipped", "pending", ""]) {
    for (const field of ["SHARD_RESULT", "PROOF_RESULT"]) {
      const executed = spawnSync("bash", ["-e", "-c", gate.run], { env: { ...process.env, SHARD_RESULT: "success", PROOF_RESULT: "success", [field]: result } });
      assert.equal(executed.status === 0, result === "success");
    }
    for (const lane of ["browser-shards", "browser-proof"]) {
      const needs = Object.fromEntries([...requiredJobs, ...managedCallerJobs].map(job => [job, { result: "success" }]));
      needs.prepare.outputs = { sha, run: "true" };
      needs[lane].result = result;
      if (result === "success") requireComplete(needs, "true", sha);
      else assert.throws(() => requireComplete(needs, "true", sha));
    }
  }
});
