import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("release incremental cache preserves bounded compiler-only trusted staging and cold/corrupt controls", () => {
  const result = spawnSync("python3", ["scripts/test_ci_incremental.py"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran [1-9][0-9]* tests/);
  assert.doesNotMatch(result.stderr, /skipped=/);
});
