// Test-only authentication of the exact token-environment delta before older
// whole-workflow fingerprints. No job, command, permission or other env is erased.
import assert from "node:assert/strict";

export function reverseAssetTokens(workflow) {
  const roles = {
    "Stable release": [
      ["workflow-lint", "Check workflows and scripts, then prove enforcement"],
      ["test-server", "Run nac-server tests"],
    ],
    "Source dependency security": [["scan", "Install pinned scanner"]],
    "Managed NAC image construction": [
      ["scanner-qualification", "Qualify real OS/Node advisory matching and runtime/DB negatives"],
      ["build-candidate", "Inventory the exact tested image"],
      ["strict-scan", "Scan the same tested image with reviewed policy"],
    ],
    "Daily managed image security": [["rescan", "Rescan retained unchanged managed image inventory"]],
  }[workflow.name];
  assert.ok(roles, "known asset-consuming workflow");
  assert.equal(workflow.env?.GITHUB_TOKEN, undefined, "token must not be workflow-wide");
  const expected = new Set();
  for (const [job, name] of roles) {
    const steps = workflow.jobs[job].steps.filter(s => s.name === name);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].env?.GITHUB_TOKEN, "${{ github.token }}");
    expected.add(steps[0]);
  }
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.env?.GITHUB_TOKEN, undefined, "token must be step-scoped");
    for (const step of job.steps ?? []) {
      if (expected.has(step)) {
        delete step.env.GITHUB_TOKEN;
        if (Object.keys(step.env).length === 0) delete step.env;
      } else assert.equal(step.env?.GITHUB_TOKEN, undefined, "unexpected token consumer");
    }
  }
}
