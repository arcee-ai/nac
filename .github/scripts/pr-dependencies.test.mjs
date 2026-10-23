import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Existing locked release-tooling dependency.
const config = YAML.parse(readFileSync(".github/dependabot.yml", "utf8"));

test("weekly dependency coverage keeps security fixes independent of routine groups, caps and majors", () => {
  assert.equal(config.version, 2);
  assert.deepEqual(config.updates.map((u) => [u["package-ecosystem"], u.directory]), [
    ["cargo", "/"],
    ["npm", "/crates/nac-server/web"],
    ["npm", "/.github/scripts"],
    ["github-actions", "/"],
    ["docker", "/docker/managed"],
  ]);
  for (const update of config.updates) {
    assert.equal(update.schedule.interval, "weekly");
    assert.equal(update["open-pull-requests-limit"], 2);
    assert.deepEqual(update.cooldown, { "default-days": 3 });
    assert.equal(update["target-branch"], undefined);
    assert.equal(update.ignore, undefined); // Majors/security fixes are never suppressed.
    const groups = Object.values(update.groups);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0], {
      "applies-to": "version-updates",
      patterns: ["*"],
      "update-types": ["minor", "patch"],
    });
  }
});

test("all executable external Actions are immutable and checkouts leave no Git credentials", () => {
  for (const name of readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f))) {
    const source = readFileSync(`.github/workflows/${name}`, "utf8");
    const workflow = YAML.parse(source);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses || step.uses.startsWith("./")) continue;
        assert.match(step.uses, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, name);
        const line = source.split("\n").find((l) => l.includes(`uses: ${step.uses}`));
        assert.match(line, / # (?:v?\d+\.\d+\.\d+|stable)\s*$/, name);
        if (step.uses.startsWith("actions/checkout@")) {
          assert.equal(step.with?.["persist-credentials"], false, name);
        }
      }
    }
  }
});
