import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { reverseNativeApp } from "./native-qualification-wiring.mjs";
const YAML = createRequire(import.meta.url)("yaml");
// Exact independently compared C521/reviewed543 job; no workflow mutation is projected away.
const reviewedPolicy = {
  "name": "Immutable startup native-folder policy source controls",
  "runs-on": "macos-26",
  "timeout-minutes": 5,
  "steps": [
    {
      "uses": "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "with": {
        "ref": "${{ inputs.source-sha }}",
        "persist-credentials": false
      }
    },
    {
      "name": "Resolve immutable startup policy supplier",
      "id": "policy-source",
      "run": "python3 -B desktop/macos/ci_startup_console_check.py --resolve >> \"$GITHUB_OUTPUT\""
    },
    {
      "uses": "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "with": {
        "ref": "${{ steps.policy-source.outputs.revision }}",
        "path": ".startup-panel-q",
        "persist-credentials": false
      }
    },
    {
      "name": "Require geometry, AX diagnostic and whole-client witness controls without skips",
      "env": {
        "NAC342_SWIFT_PANEL_PROOF": "1",
        "NAC342_AX_WITNESS_PROOF": "1"
      },
      "run": "python3 -B desktop/macos/ci_startup_console_check.py --source-root .startup-panel-q --panel\nNAC342_AX_Q_ROOT=\"$GITHUB_WORKSPACE/.startup-panel-q\" python3 -B desktop/macos/test_ci_startup_ax_lifetime.py\n"
    }
  ]
};
function verify(workflow) {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs["startup-panel-policy"], reviewedPolicy);
  reverseNativeApp(structuredClone(workflow));
}
test("required startup policy rejects content, permissions and immutable-source drift", () => {
  const workflow = YAML.parse(fs.readFileSync(".github/workflows/macos-native.yml", "utf8"));
  verify(workflow);
  for (const mutate of [
    w => { w.permissions.contents = "write"; },
    w => { w.jobs["startup-panel-policy"].permissions = { contents: "write" }; },
    w => { w.jobs["startup-panel-policy"].if = "false"; },
    w => { w.jobs["startup-panel-policy"]["continue-on-error"] = true; },
    w => { w.jobs["startup-panel-policy"].steps[0].with.ref = "dev"; },
    w => { w.jobs["startup-panel-policy"].steps[2].with["persist-credentials"] = true; },
    w => { w.jobs["startup-panel-policy"].steps[3].run = "true"; },
    w => { delete w.jobs["startup-panel-policy"].steps[3].env.NAC342_AX_WITNESS_PROOF; },
    w => { delete w.jobs["startup-panel-policy"]; },
  ]) {
    const value = structuredClone(workflow); mutate(value);
    assert.throws(() => verify(value));
  }
});
