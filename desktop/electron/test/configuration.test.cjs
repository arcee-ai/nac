"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { options, environment } = require("../src/configuration.cjs");
test("desktop launch accepts bounded explicit arguments and never parses shell flags", () => {
  assert.deepEqual(
    options(["--directory", "/a space", "--store-path", "/a/db", "--command-path", "/tools"]),
    { commandPaths: ["/tools"], directory: "/a space", store: "/a/db" },
  );
  for (const args of [
    ["--eval", "code"],
    ["--directory", "/a", "--directory", "/b"],
    ["--store-path"],
    ["--command-path", "a\0b"],
  ])
    assert.throws(() => options(args));
});
test("Finder environment composes normal command paths without executing dotfiles", () => {
  const env = environment(
    { HOME: "/home", PATH: "/usr/bin:relative", NAC_HOME: "/config", NAC_DESKTOP_CHANNEL_FD: "99" },
    "/cwd",
    ["/custom"],
  );
  assert.equal(
    env.PATH,
    "/custom:/usr/bin:/cwd/relative:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin",
  );
  assert.equal(env.NAC_HOME, "/config");
  assert.equal(env.NAC_DESKTOP_CHANNEL_FD, undefined);
  assert.throws(() => environment({ PATH: "a".repeat(33000) }, "/cwd", []));
});
