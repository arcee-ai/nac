"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { folderPicker } = require("../src/folder.cjs");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nac-folder-result-"));
  const helper = path.join(directory, "selected-result");
  // This exact test child emits a panel-shaped result and exits; no UI or
  // product renderer bridge is substituted or installed.
  fs.writeFileSync(
    helper,
    "#!/usr/bin/env node\nprocess.stdout.write(process.argv[2] + '\\n');\n",
    { mode: 0o700 },
  );
  return {
    directory,
    select: (value) => folderPicker(JSON.stringify(value), helper).promise,
    close: () => fs.rmSync(directory, { recursive: true }),
  };
}

test("directory aliases return canonical form data for normal Rust admission", async () => {
  const f = fixture();
  try {
    const selected = path.join(f.directory, "Actual Folder α");
    const alias = path.join(f.directory, "Selected Alias");
    fs.mkdirSync(selected);
    fs.symlinkSync(selected, alias, "dir");
    assert.equal(await f.select({ path: alias }), fs.realpathSync(selected));
    assert.equal(await f.select({ path: selected }), fs.realpathSync(selected));
  } finally {
    f.close();
  }
});

test("files, file aliases, broken aliases and moved directories stay refused", async () => {
  const f = fixture();
  try {
    const file = path.join(f.directory, "file.txt");
    const fileAlias = path.join(f.directory, "file-alias");
    const broken = path.join(f.directory, "broken");
    const moved = path.join(f.directory, "moved");
    fs.writeFileSync(file, "fixture");
    fs.symlinkSync(file, fileAlias);
    fs.symlinkSync(path.join(f.directory, "missing"), broken, "dir");
    fs.mkdirSync(moved);
    fs.renameSync(moved, moved + "-away");
    for (const selected of [file, fileAlias, broken, moved])
      assert.equal(await f.select({ path: selected }), null);
  } finally {
    f.close();
  }
});

test("malformed panel data does not gain path authority from canonicalization", async () => {
  const f = fixture();
  try {
    for (const value of [
      { path: "." },
      { path: "bad\0path" },
      { path: f.directory, extra: true },
      { path: 123 },
      { path: null },
    ])
      assert.equal(await f.select(value), null);
  } finally {
    f.close();
  }
});
