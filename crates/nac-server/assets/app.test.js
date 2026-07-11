const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const context = {
  document: { addEventListener() {} },
  module: { exports: {} },
};
vm.runInNewContext(
  `${appSource}\nmodule.exports = { orderedThreadTiles };`,
  context,
  { filename: "app.js" },
);
const { orderedThreadTiles } = context.module.exports;

test("thread tiles use raw case-sensitive name order independently without mutating inputs", () => {
  const sections = [
    ["ä", "a", "B", "A"],
    ["z", "Z", "aa"],
    ["beta", "alpha", "Alpha"],
  ].map((names) => names.map((name) => ({ name })));
  const before = sections.map((tiles) => tiles.map(({ name }) => name));
  const ordered = sections.map((tiles) => Array.from(
    orderedThreadTiles(tiles),
    ({ name }) => name,
  ));

  assert.deepEqual(Array.from(ordered[0]), ["A", "B", "a", "ä"]);
  assert.deepEqual(Array.from(ordered[1]), ["Z", "aa", "z"]);
  assert.deepEqual(Array.from(ordered[2]), ["Alpha", "alpha", "beta"]);
  assert.deepEqual(
    sections.map((tiles) => tiles.map(({ name }) => name)),
    before,
  );
});
