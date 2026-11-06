import { reverseAdmission } from "./ci-admission-wiring.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import {
  qualityJobs, qualityReceipt, verifyQuality, qualityMode,
  requiredJobs, managedCallerJobs, requireComplete,
} from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Existing locked release-tooling dependency.
const stable = () => { const value = YAML.parse(readFileSync(".github/workflows/stable-release.yml", "utf8")); reverseAdmission(value); return value; };
const roles = ["test-server", "test-server-web"];
const sha = "a".repeat(40);
const context = { run_id: "123", run_attempt: "1", repository: "arcee-ai/nac" };
const needsFor = jobs => ({
  ...Object.fromEntries(jobs.map(job => [job, { result: "success" }])),
  prepare: { result: "success", outputs: { sha, run: "true" } },
});
const quality = () => needsFor(qualityJobs);
const final = (managed = "true") => {
  const needs = needsFor([...requiredJobs, ...managedCallerJobs]);
  for (const role of managedCallerJobs) needs[role].result = managed === "true" ? "success" : "skipped";
  return needs;
};
const mandatory = step => {
  assert.ok(step);
  assert.equal(step.if, undefined);
  assert.equal(step["continue-on-error"], undefined);
};

test("both server lanes start from the exact prepared candidate with pinned runtimes", () => {
  for (const role of roles) {
    const job = stable().jobs[role];
    assert.ok(job, `${role} is an explicit lane`);
    assert.equal(job.needs, "prepare");
    assert.equal(job.if, "${{ needs.prepare.outputs.run == 'true' }}");
    assert.equal(job["continue-on-error"], undefined);
    const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
    mandatory(checkout);
    assert.equal(checkout.with.ref, "${{ needs.prepare.outputs.sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
    mandatory(job.steps.find(step => step.uses === "dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0"));
    const node = job.steps.find(step => step.uses?.startsWith("actions/setup-node@"));
    mandatory(node);
    assert.equal(node.with["node-version"], "24.22.1");
    assert.equal(node.with.cache, undefined);
  }
});

test("frontend unit and full API/assets acceptance remain mandatory while backend retains full tests and stable identity", () => {
  const jobs = stable().jobs;
  const web = jobs["test-server-web"].steps;
  mandatory(web.find(step => step.run === "npm ci" && step["working-directory"] === "crates/nac-server/web"));
  mandatory(web.find(step => step.run === "npm test" && step["working-directory"] === "crates/nac-server/web"));
  mandatory(web.find(step => step.run === "make test-assets"));
  const backend = jobs["test-server"].steps;
  mandatory(backend.find(step => step.run === "python3 .github/scripts/server-tests.py"));
  mandatory(backend.find(step => step.run === "make test-stable-binary"));
  assert.ok(!backend.some(step => /npm (?:ci|test)/.test(step.run ?? "")), "web dependencies and tests have one owner");
  const makefile = readFileSync("Makefile", "utf8");
  assert.match(makefile, /^test-assets: test-api-contract$/m);
  const recipe = name => {
    const match = makefile.match(new RegExp(`^${name}:[^\\n]*\\n((?:\\t[^\\n]*\\n|\\n)*)`, "m"));
    assert.ok(match, `${name} has an explicit recipe`);
    return match[1];
  };
  const assets = recipe("test-assets");
  for (const command of ["run lint", "run typecheck", "run build"])
    assert.ok(assets.includes(`npm --prefix $(WEB_DIR) ${command}`));
  const api = recipe("test-api-contract");
  assert.ok(api.includes("$(CARGO) run --locked -p nac-server --example export-openapi -- --check $(WEB_DIR)/openapi.json"));
  assert.ok(api.includes("npm --prefix $(WEB_DIR) run check:api"));
  for (const output of ["assets/dist", "packages/nac-client/dist", "packages/nac-presentation/dist"])
    assert.ok(assets.includes(output));
  assert.ok(assets.includes("git status --porcelain -- crates/$(PKG)/assets/dist"));
});

test("quality and final aggregates explicitly require both lanes without a third server join", () => {
  const workflow = stable();
  assert.deepEqual([...workflow.jobs.quality.needs].sort(), [...qualityJobs].sort());
  assert.deepEqual([...workflow.jobs["required-pr-checks"].needs].sort(), [...requiredJobs, ...managedCallerJobs].sort());
  for (const role of roles) {
    assert.equal(qualityJobs.filter(job => job === role).length, 1);
    assert.equal(requiredJobs.filter(job => job === role).length, 1);
  }
});

test("missing, failed, skipped and cancelled server lanes cannot mint quality or pass either applicability aggregate", () => {
  const complete = qualityReceipt(quality(), sha, context);
  verifyQuality(complete, sha, context);
  for (const managed of ["true", "false"]) requireComplete(final(managed), managed, sha);
  for (const role of roles) {
    for (const result of ["failure", "skipped", "cancelled", undefined]) {
      const qualityNeeds = quality();
      qualityNeeds[role].result = result;
      assert.throws(() => qualityReceipt(qualityNeeds, sha, context), undefined, `${role}/${result}`);
      assert.throws(() => verifyQuality({ ...complete, results: { ...complete.results, [role]: result } }, sha, context));
      for (const managed of ["true", "false"]) {
        const finalNeeds = final(managed);
        finalNeeds[role].result = result;
        assert.throws(() => requireComplete(finalNeeds, managed, sha));
      }
    }
    const missing = quality();
    delete missing[role];
    assert.throws(() => qualityReceipt(missing, sha, context));
    const missingFinal = final();
    delete missingFinal[role];
    assert.throws(() => requireComplete(missingFinal, "true", sha));
  }
});

test("expanded receipts retain exact run identity and rerun full fallback rather than incomplete reuse", () => {
  const receipt = qualityReceipt(quality(), sha, context);
  assert.equal(qualityMode(null, sha, context), "full");
  assert.equal(qualityMode(receipt, sha, context), "reuse");
  assert.equal(qualityMode(receipt, sha, { ...context, run_attempt: "2" }), "full");
  for (const [field, value] of [["sha", "b".repeat(40)], ["run_id", "124"], ["repository", "other/repo"], ["run_attempt", "2"]])
    assert.throws(() => qualityMode({ ...receipt, [field]: value }, sha, context));
  const incomplete = structuredClone(receipt);
  delete incomplete.results["test-server-web"];
  assert.throws(() => qualityMode(incomplete, sha, { ...context, run_attempt: "2" }));
});
