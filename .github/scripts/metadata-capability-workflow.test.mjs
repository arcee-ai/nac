import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import { execFileSync } from "node:child_process";
const root = new URL("../workflows/", import.meta.url);
const load = name => YAML.parse(fs.readFileSync(new URL(name, root), "utf8"));
const parent = load("nightly-portability.yml");
const child = load("metadata-capability-child-diag.yml");
const pure = "needs.select.result == 'success' && needs.select.outputs.mode == 'pure'";
const aggregate = "${{ " + pure + " && 'DIAG PURE aggregate' || 'DIAG FULL aggregate default' }}";
const caller = "${{ (inputs.phase == 'admit' && needs.sentinel.result == 'success' && needs.sentinel.outputs.mode == 'pure' || inputs.phase == 'observe' && " + pure + ") && 'DIAG PURE caller omitted' || 'DIAG FULL caller default' }}";
function verify(p, c) {
  assert.deepEqual(Object.keys(p.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(c.on), ["workflow_call"]);
  assert.deepEqual(p.permissions, {contents:"read"});
  assert.deepEqual(c.permissions, {contents:"read"});
  assert.deepEqual(Object.keys(p.jobs), ["select","sentinel","aggregate","caller"]);
  assert.deepEqual(Object.keys(c.jobs), ["child"]);
  assert.deepEqual(p.on.workflow_dispatch.inputs.phase.options, ["admit","observe"]);
  assert.deepEqual(p.concurrency, {group:"diag-metadata-${{ github.run_id }}-${{ github.run_attempt }}", "cancel-in-progress":false});
  assert.equal(p.jobs.aggregate.name, aggregate);
  assert.equal(p.jobs.caller.name, caller);
  assert.equal(p.jobs.aggregate.if, "${{ always() }}");
  assert.equal(p.jobs.caller.if, "${{ always() && !(" + pure + ") }}");
  assert.deepEqual(p.jobs.caller.needs, ["select","sentinel"]);
  assert.equal(p.jobs.caller.uses, "./.github/workflows/metadata-capability-child-diag.yml");
  assert.equal(p.jobs.sentinel.steps[0].run.trim(), 'test "$DIAG_PHASE" = observe');
  assert.equal(p.jobs.select.outputs.mode, "${{ steps.select.outputs.mode }}");
  assert.equal(p.jobs.sentinel.outputs.mode, "${{ steps.empty.outputs.mode }}");
  const jobs = [...Object.values(p.jobs),...Object.values(c.jobs)];
  for (const job of jobs) {
    assert.match(job.name, /^DIAG |^\$\{\{/);
    if (job.uses) continue;
    assert.equal(job["timeout-minutes"], 1);
    assert.equal(job["runs-on"], "ubuntu-latest");
    for (const step of job.steps) {
      if (step.uses) {
        assert.equal(step.uses, "actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
        assert.deepEqual(step.with, {ref:"${{ github.sha }}", "persist-credentials":false});
      }
      assert.doesNotMatch(step.run ?? "", /cargo|npm|sleep|docker|curl|gh api/);
      assert.ok(!JSON.stringify(step.env ?? {}).includes("github.token"));
    }
  }
  const text = JSON.stringify([p,c]);
  assert.doesNotMatch(text, /Required PR checks|Full locked source scan|ARM macOS process and credentials|pull_request|cache|retry|secrets/);
}
test("four-node manual graph has DIAG-only full, failed/missing defaults and PURE names", () => verify(parent,child));
test("unsafe graph/naming/permission mutations are rejected", () => {
  const edits = [
    p => {p.on.push = {};}, p => {p.permissions.actions = "read";},
    p => {p.jobs.aggregate.name = "Required PR checks";},
    p => {p.jobs.caller.name = "DIAG FULL caller default";},
    p => {p.jobs.caller.if = "${{ success() }}";},
    p => {p.jobs.select["timeout-minutes"] = 3;},
    p => {p.jobs.extra = p.jobs.sentinel;},
    p => {p.jobs.sentinel.steps[0].run = "true";},
    p => {p.jobs.select.steps[0].with["persist-credentials"] = true;},
  ];
  for (const edit of edits) {
    const value = structuredClone(parent); edit(value);
    assert.throws(() => verify(value,child));
  }
});
test("failed and missing selectors remain actual graph observations", () => {
  assert.match(parent.jobs.aggregate.name, /needs.select.result == 'success'/);
  assert.match(parent.jobs.aggregate.name, /DIAG FULL aggregate default/);
  assert.match(parent.jobs.caller.name, /needs.sentinel.result == 'success'/);
  assert.match(parent.jobs.caller.name, /DIAG FULL caller default/);
  assert.equal(parent.jobs.aggregate.steps[0].env.DIAG_MISSING_DEFAULT,
    "${{ needs.sentinel.result == 'success' && needs.sentinel.outputs.mode == 'pure' && 'DIAG PURE invalid' || 'DIAG FULL no-output default' }}");
  assert.match(parent.jobs.aggregate.steps[0].run, /test -z "\$DIAG_SENTINEL_MODE"/);
});

test("registered path revision keeps the original four-node parent byte-identical", () => {
  assert.deepEqual(Object.keys(parent.on), ["workflow_dispatch"]);
  const original = execFileSync("git", ["show", "6a546046ca916d3cbea358f5298f4545beabe27c:.github/workflows/metadata-capability-diag.yml"], {encoding:"utf8"});
  assert.equal(fs.readFileSync(new URL("nightly-portability.yml", root), "utf8"), original);
  assert.ok(!fs.existsSync(new URL("apt-runtime-parity.yml", root)));
  const script = fs.readFileSync(new URL("./metadata-capability-diag.py", import.meta.url), "utf8");
  assert.ok(script.includes('BRANCH = "refs/heads/codex/all-582-metadata-capability-registered"'));
  assert.ok(script.includes('WORKFLOW = ".github/workflows/nightly-portability.yml"'));
  assert.ok(!fs.existsSync(new URL("metadata-capability-diag.yml", root)));
});
