import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const YAML = createRequire(import.meta.url)("yaml");
const token = "${{ github.token }}";
const workflows = fs.readdirSync(".github/workflows").filter(f => /\.ya?ml$/.test(f))
  .map(file => ({ file, value: YAML.parse(fs.readFileSync(`.github/workflows/${file}`, "utf8")) }));

// Discover callers from commands, independently of the historical fingerprint guard.
function scannerCallers(candidates) {
  return candidates.flatMap(({ file, value }) => Object.entries(value.jobs).flatMap(([job, config]) =>
    (config.steps ?? []).filter(step => /scripts\/security\/image_(?:qualify|scan|rescan|prepublication)\.py\b/.test(step.run ?? ""))
      .map(step => ({ file, value, job, config, step }))));
}

function validate(candidates) {
  const callers = scannerCallers(candidates);
  assert.equal(callers.length, 4, "all four scanner entry steps must be discovered");
  for (const { file, value, config, step } of callers) {
    assert.equal(value.env?.GITHUB_TOKEN, undefined);
    assert.equal(config.env?.GITHUB_TOKEN, undefined);
    assert.equal(config.permissions, undefined, "no job permission override");
    assert.deepEqual(value.permissions, file === "image-security-rescan.yml"
      ? { contents: "read", actions: "read" } : { contents: "read" });
    assert.equal(step.env?.GITHUB_TOKEN, token, `${file}: ${step.name} needs the existing job token`);
    if (file === "image-security-rescan.yml") assert.equal(step.env.GH_TOKEN, token, "gh API keeps its binding");
  }
}

test("every discovered scanner entry step receives the existing read-only job token", () => {
  validate(workflows);
  assert.deepEqual(scannerCallers(workflows).map(c => `${c.file}/${c.job}/${c.step.name}`).sort(), [
    "image-security-rescan.yml/rescan/Rescan retained unchanged managed image inventory",
    "managed-image-build.yml/build-candidate/Inventory the exact tested image",
    "managed-image-build.yml/strict-scan/Scan the same tested image with reviewed policy",
    "managed-image-build.yml/scanner-qualification/Qualify real OS/Node advisory matching and runtime/DB negatives",
  ].sort());
});

test("each omitted, GH_TOKEN-only or substituted scanner token and widened permission is rejected", () => {
  for (let index = 0; index < 4; index++) {
    for (const mutate of [
      c => { delete c.step.env.GITHUB_TOKEN; },
      c => { delete c.step.env.GITHUB_TOKEN; c.step.env.GH_TOKEN = token; },
      c => { c.step.env.GITHUB_TOKEN = "${{ secrets.PAT }}"; },
      c => { c.value.permissions.contents = "write"; },
      c => { c.config.permissions = { contents: "write" }; },
    ]) {
      const candidate = structuredClone(workflows);
      mutate(scannerCallers(candidate)[index]);
      assert.throws(() => validate(candidate));
    }
  }
});
