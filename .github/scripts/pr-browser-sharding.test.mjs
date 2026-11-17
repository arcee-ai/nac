import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { requiredJobs, managedCallerJobs, requireComplete } from "./pr-checks.mjs";
import { reverseBrowserApt } from "./browser-apt-wiring.mjs";

const YAML = createRequire(import.meta.url)("yaml");
const workflow = YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));

test("ordinary test-granularity shards execute the inventoried exclusion while proof stays serial", () => {
  const job = workflow.jobs["browser-shards"];
  assert.deepEqual(job.needs, ["prepare", "browser-binary", "browser-apt"]);
  assert.deepEqual(job.strategy, { "fail-fast": false, matrix: { shard: [1, 2, 3, 4, 5, 6, 7, 8] } });
  assert.equal(job.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  const execute = job.steps.find(step => step.name === "Run production-embedded browser shard");
  assert.equal(execute.env.BROWSER_SHARD, "${{ matrix.shard }}");
  assert.equal(execute.run, "npm --prefix crates/nac-server/web run test:e2e -- --fully-parallel --grep-invert='exact-goal-wait.e2e.ts' --shard=\"$BROWSER_SHARD/8\"");
  assert.doesNotMatch(execute.run, /--workers|--retries/);
  const proof = workflow.jobs["browser-proof"];
  assert.deepEqual(proof.needs, ["prepare", "browser-binary", "browser-apt"]);
  assert.equal(proof.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  const select = proof.steps.find(step => step.name === "Verify complete disjoint current browser selection");
  assert.match(select.run, /for shard in 1 2 3 4 5 6 7 8;/);
  assert.match(select.run, /test --fully-parallel --grep-invert='exact-goal-wait.e2e.ts' --shard="\$shard\/8" --list --reporter=json/);
  assert.equal(select.run.split("--fully-parallel").length, 2);
  assert.match(select.run, /playwright test --list --reporter=json/);
  assert.match(select.run, /playwright test exact-goal-wait.e2e.ts --list --reporter=json/);
  assert.match(select.run, /browser-inventory.py/);
  for (const part of ["proof", ...Array.from({ length: 8 }, (_, n) => `ordinary-${n + 1}`)]) {
    assert.ok(select.run.includes(`--part browser-inventory/${part}.json`));
  }
  const run = proof.steps.find(step => step.name === "Run production-embedded goal proof journeys");
  assert.match(run.run, /run test:e2e -- exact-goal-wait.e2e.ts\s*$/);
  assert.doesNotMatch(run.run, /--fully-parallel|--workers|--retries/);
  const stage = proof.steps.find(step => step.name === "Stage only the two bounded ALL471 goal receipts");
  assert.equal(stage.if, "always()");
  assert.equal(stage.env.GOAL_PROOF_SOURCE, "${{ needs.prepare.outputs.sha }}");
  assert.match(stage.run, /browser-proof.py.*--source "\$GOAL_PROOF_SOURCE"/);
  const artifact = proof.steps.find(step => step.name === "Retain only ALL471 goal proof and cleanup receipts");
  assert.equal(artifact.with.path, "crates/nac-server/web/test-results/all471-goal-proof-artifact/*.json");
  assert.equal(artifact.with["if-no-files-found"], "error");
  for (const item of [job, proof]) for (const step of item.steps) assert.equal(step["continue-on-error"], undefined);
});

function verifyGranularity(value) {
  const before = structuredClone(value); reverseAssetTokens(before);
  // Authenticate and reverse the later relay before the historical S02 guard.
  reverseBrowserApt(before);
  for (const step of [
    before.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard"),
    before.jobs["browser-proof"].steps.find(s => s.name === "Verify complete disjoint current browser selection"),
  ]) {
    assert.equal(step.run.split("--fully-parallel").length, 2);
    assert.ok(step.run.includes("--fully-parallel --grep-invert='exact-goal-wait.e2e.ts'"));
    step.run = step.run.replace("--fully-parallel ", "");
  }
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : v;
  assert.equal(createHash("sha256").update(JSON.stringify(sort(before))).digest("hex"),
    "8e48b71c0b261aa0f4ddb0aa96500311d777e9a643d7eaa6650ab0123dac9983",
    "exact canonical workflow at3769e2aa11d2c36de75305355f167c921b2b81e8, including S12/provenance/S17");
}

test("reversing only the two ordinary flags recovers the exact pre-refinement workflow", () => verifyGranularity(workflow));

test("granularity cannot drift between collection/execution or spread to proof, workers or retries", () => {
  for (const mutate of [
    w => { w.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard").run = w.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard").run.replace("--fully-parallel ", ""); },
    w => { w.jobs["browser-proof"].steps.find(s => s.name === "Verify complete disjoint current browser selection").run = w.jobs["browser-proof"].steps.find(s => s.name === "Verify complete disjoint current browser selection").run.replace("--fully-parallel ", ""); },
    w => { w.jobs["browser-proof"].steps.find(s => s.name === "Run production-embedded goal proof journeys").run += " --fully-parallel"; },
    w => { w.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard").run += " --workers=2"; },
    w => { w.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard").run += " --retries=1"; },
    w => { w.jobs["browser-shards"].steps.find(s => s.id === "apt-consume").run = "true"; },
  ]) {
    const changed = structuredClone(workflow); mutate(changed); assert.throws(() => verifyGranularity(changed));
  }
});

test("browser compatibility join and final gate reject every incomplete shard/proof result", () => {
  const browser = workflow.jobs.browser;
  assert.deepEqual(browser.needs, ["prepare", "browser-binary", "browser-apt", "browser-shards", "browser-proof"]);
  assert.match(browser.if, /always\(\)/);
  const gate = browser.steps[0];
  assert.equal(gate.env.BINARY_RESULT, "${{ needs.browser-binary.result }}");
  assert.equal(gate.env.APT_RESULT, "${{ needs.browser-apt.result }}");
  assert.equal(gate.env.SHARD_RESULT, "${{ needs.browser-shards.result }}");
  assert.equal(gate.env.PROOF_RESULT, "${{ needs.browser-proof.result }}");
  for (const lane of ["browser-binary", "browser-apt", "browser-shards", "browser-proof"]) {
    assert.ok(requiredJobs.includes(lane));
    assert.ok(workflow.jobs["required-pr-checks"].needs.includes(lane));
  }
  const sha = "a".repeat(40);
  for (const result of ["success", "failure", "cancelled", "skipped", "pending", ""]) {
    for (const field of ["BINARY_RESULT", "APT_RESULT", "SHARD_RESULT", "PROOF_RESULT"]) {
      const executed = spawnSync("bash", ["-e", "-c", gate.run], { env: { ...process.env, BINARY_RESULT: "success", APT_RESULT: "success", SHARD_RESULT: "success", PROOF_RESULT: "success", [field]: result } });
      assert.equal(executed.status === 0, result === "success");
    }
    for (const lane of ["browser-binary", "browser-apt", "browser-shards", "browser-proof"]) {
      const needs = Object.fromEntries([...requiredJobs, ...managedCallerJobs].map(job => [job, { result: "success" }]));
      needs.prepare.outputs = { sha, run: "true" };
      needs[lane].result = result;
      if (result === "success") requireComplete(needs, "true", sha);
      else assert.throws(() => requireComplete(needs, "true", sha));
    }
  }
});
