import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import { reverseAdmission } from "./ci-admission-wiring.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { reverseBrowserApt } from "./browser-apt-wiring.mjs";

const YAML = createRequire(import.meta.url)("yaml");
const read = () => YAML.parse(readFileSync(".github/workflows/stable-release.yml", "utf8"));
const trust = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : value;
function verify(workflow) {
  workflow = structuredClone(workflow); reverseAssetTokens(workflow); reverseAdmission(workflow);
  const job = workflow.jobs["test-server"];
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job.needs, "prepare");
  assert.equal(job.if, "${{ needs.prepare.outputs.run == 'true' }}");
  assert.deepEqual(job.env, { CARGO_PROFILE_TEST_DEBUG: "0", CARGO_PROFILE_DEV_DEBUG: "0" });
  const cache = job.steps.find(s => s.uses?.startsWith("Swatinem/"));
  assert.equal(cache.uses, "Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4");
  assert.deepEqual(cache.with, {
    "prefix-key": "${{ needs.prepare.outputs.cold_caches == 'true' && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}",
    "shared-key": "server-browser-linux-gnu-debug0-v1", "save-if": trust,
  });
  assert.deepEqual(job.steps.find(s => s.name === "Run nac-server tests"), {
    name: "Run nac-server tests", run: "python3 .github/scripts/server-tests.py",
  });
  assert.deepEqual(job.steps.at(-1), {
    name: "Exercise stable binary readiness and status identity", run: "make test-stable-binary",
  });
  assert.equal(job.permissions, undefined);
  for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
  assert.ok(job.steps.some(s => s.uses === "dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0"));
  const reversed = structuredClone(workflow);
  // Authenticate and reverse the later relay before the historical S01 guard.
  reverseBrowserApt(reversed);
  // S02 changes only ordinary execution/list granularity, never the proof CLI.
  for (const step of [
    reversed.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard"),
    reversed.jobs["browser-proof"].steps.find(s => s.name === "Verify complete disjoint current browser selection"),
  ]) {
    assert.equal(step.run.split("--fully-parallel").length, 2);
    assert.ok(step.run.includes("--fully-parallel --grep-invert='exact-goal-wait.e2e.ts'"));
    step.run = step.run.replace("--fully-parallel ", "");
  }
  reversed.jobs["test-server"].steps.find(s => s.name === "Run nac-server tests").run = "cargo test -p nac-server --locked";
  // Canonical projection retains required startup custody and isolated native auth checks.
  // Reverse ONLY S12's server input: all three provenance fields stay present.
  assert.equal(createHash("sha256").update(JSON.stringify(sort(reversed))).digest("hex"),
    "d58c312b872e6dc99dd0ba26f0dde69192e185297912c7125f10764bb2d77877");
}

test("only the server runner input changes; pinned compiler/cache trust and stable identity stay", () => verify(read()));
test("parsed runner/profile/cache weakening fails closed", () => {
  for (const mutate of [
    w => { w.jobs["test-server"].steps.find(s => s.name === "Run nac-server tests").run += " --lib"; },
    w => { w.jobs["test-server"].steps.find(s => s.name === "Run nac-server tests")["continue-on-error"] = true; },
    w => { w.jobs["test-server"].steps.find(s => s.name === "Run nac-server tests").if = "always()"; },
    w => { w.jobs["test-server"].steps.at(-1).run = "true"; },
    w => { w.jobs["test-server"].env.CARGO_INCREMENTAL = "0"; },
    w => { w.jobs["test-server"].env.CARGO_PROFILE_TEST_DEBUG = "2"; },
    w => { w.jobs["test-server"].steps.find(s => s.uses?.startsWith("Swatinem/")).with["save-if"] = "true"; },
    w => { w.jobs["test-server"].steps.find(s => s.uses?.startsWith("Swatinem/")).with["cache-all-crates"] = true; },
    w => { w.jobs["test-server"]["runs-on"] = "macos-latest"; },
    w => { w.jobs["browser-apt"].steps.find(s => s.id === "apt-upload").with["if-no-files-found"] = "ignore"; },
  ]) { const candidate = read(); mutate(candidate); assert.throws(() => verify(candidate)); }
});
test("real stdlib installer, private-store policy and failure propagation controls", () => {
  const result = spawnSync("python3", [".github/scripts/server-tests.test.py"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
