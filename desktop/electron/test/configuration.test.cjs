"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { options, environment, launchPaths } = require("../src/configuration.cjs");
test("development launch and preparation share repository defaults and absolute overrides", () => {
  const root = path.resolve(__dirname, "../../..");
  assert.deepEqual(launchPaths({ packaged: false, env: {} }), {
    resources: path.join(root, "target/electron-resources"),
    executable: path.join(root, "target/release/nac-web"),
  });
  assert.deepEqual(
    launchPaths({
      packaged: false,
      env: {
        NAC_ELECTRON_RESOURCES: "/private/custom resources",
        NAC_ELECTRON_ENGINE: "/private/custom engine",
      },
    }),
    { resources: "/private/custom resources", executable: "/private/custom engine" },
  );
  for (const name of ["NAC_ELECTRON_ENGINE", "NAC_ELECTRON_RESOURCES"])
    for (const value of ["relative", "", "/absolute\0invalid"])
      assert.throws(() => launchPaths({ packaged: false, env: { [name]: value } }));
});
test("packaged paths ignore all development overrides and bind the exact resource directory", () => {
  assert.deepEqual(
    launchPaths({
      packaged: true,
      resourcesPath: "/relocated/NAC.app/Contents/Resources",
      env: {
        NAC_ELECTRON_ENGINE: "invalid relative override",
        NAC_ELECTRON_RESOURCES: "/other/resources",
      },
    }),
    {
      resources: "/relocated/NAC.app/Contents/Resources",
      executable: "/relocated/NAC.app/Contents/Resources/nac-web",
    },
  );
  assert.throws(() => launchPaths({ packaged: true, resourcesPath: "relative", env: {} }));
});
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
