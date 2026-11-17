import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { reverseNativeApp } from "./native-qualification-wiring.mjs";
import { fullGuard, sourceJobs } from "./ci-admission-wiring.mjs";
import { INPUTS } from "./source-security.mjs";
const YAML = createRequire(import.meta.url)("yaml");
const read = (name) => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, "utf8"));

function verify(native) {
  assert.deepEqual(native.permissions, { contents: "read" });
  assert.ok(native.jobs.electron, "Electron is required, not an optional dispatch");
  reverseNativeApp(structuredClone(native));
}

test("automatic admitted PR graph requires exact-head normal Electron, retaining prior source guards", () => {
  const stable = read("stable-release");
  assert.ok(stable.on.pull_request.types.includes("synchronize"));
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("macos-native"));
  const caller = stable.jobs["macos-native"];
  assert.equal(caller.if, fullGuard(sourceJobs["macos-native"]));
  assert.equal(caller.uses, "./.github/workflows/macos-native.yml");
  assert.equal(caller.with["source-sha"], "${{ needs.prepare.outputs.sha }}");
  const native = read("macos-native");
  verify(native);
  const job = native.jobs.electron;
  assert.equal(job["runs-on"], "macos-26");
  const head =
    "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || inputs.source-sha }}";
  assert.equal(job.steps[0].with.ref, head);
  assert.equal(job.steps.find((step) => step.env?.EXPECTED_SHA).env.EXPECTED_SHA, head);
  assert.equal(job.if, undefined);
  assert.ok(INPUTS.includes("desktop/electron/package-lock.json"));
  for (const mutate of [
    (w) => {
      delete w.jobs.electron;
    },
    (w) => {
      w.jobs.electron.if = "false";
    },
    (w) => {
      w.jobs.electron["continue-on-error"] = true;
    },
    (w) => {
      w.jobs.electron.steps[0].with.ref = "dev";
    },
    (w) => {
      w.jobs.electron.steps[0].with["persist-credentials"] = true;
    },
    (w) => {
      w.jobs.electron.steps[3].with["save-if"] = "true";
    },
    (w) => {
      w.jobs.electron.steps[4].run = "true";
    },
    (w) => {
      w.jobs.electron.steps[5].with.path = "/Users/runner";
    },
    (w) => {
      w.permissions.contents = "write";
    },
  ]) {
    const changed = structuredClone(native);
    mutate(changed);
    assert.throws(() => verify(changed));
  }
});
