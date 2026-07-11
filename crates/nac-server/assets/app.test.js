const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const indexSource = readFileSync(require.resolve("./index.html"), "utf8");
const context = {
  document: { addEventListener() {} },
  module: { exports: {} },
};
vm.runInNewContext(
  `${appSource}\nmodule.exports = { orderedThreadsByName, orderedThreadTiles };`,
  context,
  { filename: "app.js" },
);
const { orderedThreadsByName, orderedThreadTiles } = context.module.exports;

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

test("Events worker groups sort each lifecycle section without reordering their entries", () => {
  const sections = [
    ["runner-z", "Runner-A", "runner-a"],
    ["queued-2", "queued-10"],
    ["finished/ä", "finished/a", "Finished"],
  ].map((names, sectionIndex) => names.map((name, groupIndex) => ({
    name,
    items: [
      `newest-${sectionIndex}-${groupIndex}`,
      `middle-${sectionIndex}-${groupIndex}`,
      `oldest-${sectionIndex}-${groupIndex}`,
    ],
  })));
  const beforeNames = sections.map((groups) => groups.map(({ name }) => name));
  const beforeItems = new Map(sections.flat().map((group) => [group, [...group.items]]));
  const ordered = sections.map((groups) => orderedThreadsByName(groups));

  assert.deepEqual(Array.from(ordered[0], ({ name }) => name), ["Runner-A", "runner-a", "runner-z"]);
  assert.deepEqual(Array.from(ordered[1], ({ name }) => name), ["queued-10", "queued-2"]);
  assert.deepEqual(Array.from(ordered[2], ({ name }) => name), ["Finished", "finished/a", "finished/ä"]);
  assert.deepEqual(
    sections.map((groups) => groups.map(({ name }) => name)),
    beforeNames,
  );
  for (const group of sections.flat()) {
    assert.deepEqual(group.items, beforeItems.get(group));
  }
});


test("launch and settings backend selectors expose explicit Arcee modes only", () => {
  for (const id of ["launchBackend", "settingsBackend"]) {
    const select = indexSource.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
    assert.match(select, /value="arcee-auth">arcee-auth</);
    assert.match(select, /value="arcee-api">arcee-api</);
    assert.doesNotMatch(select, /value="arcee"/);
    assert.doesNotMatch(select, /value="auto"/);
  }
});
