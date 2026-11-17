"use strict";
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("CI failure/export/source controls stay portable and bounded", () => {
  execFileSync("python3", ["-B", path.join(__dirname, "../scripts/test_ci.py")], {
    stdio: "pipe",
  });
});
