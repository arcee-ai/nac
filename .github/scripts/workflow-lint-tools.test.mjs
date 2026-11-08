import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { downloadUrl, installTools, pins } from "./workflow-lint-tools.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
test("qualified Linux asset IDs remain tied to the original version and digest", () => {
  for (const [name, version, id, digest] of [
    ["actionlint", "1.7.12", 384924896, "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"],
    ["shellcheck", "0.11.0", 336391469, "b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6"],
  ]) {
    const pin = pins[name];
    assert.equal(pin.version, version);
    assert.equal(pin.assets["linux-x64"][1], digest);
    assert.deepEqual(pin.release_asset_ids, { [version]: { "linux-x64": id } });
    assert.equal(downloadUrl(pin, "linux-x64"), `https://api.github.com/repos/${pin.repository}/releases/assets/${id}`);
    for (const platform of ["linux-arm64", "darwin-x64", "darwin-arm64"])
      assert.equal(downloadUrl(pin, platform), `https://github.com/${pin.repository}/releases/download/v${version}/${pin.assets[platform][0]}`);
    assert.throws(() => downloadUrl(pin, "unknown"), /unsupported/);
    assert.throws(() => downloadUrl({ ...pin, version: "999.0.0" }, "linux-x64"), /stale/);
    for (const bad of [null, false, 0, -1, "123", 1.5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => downloadUrl({ ...pin, release_asset_ids: { [version]: { "linux-x64": bad } } }, "linux-x64"), /invalid/);
  }
});

// Exercise the real installer and cache admission without executing any archive.
function installerFixture(t, mode) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "nac-tool-transport-"));
  const savedPins = structuredClone(pins);
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  const bytes = Buffer.from("verified fixture archive");
  for (const pin of Object.values(pins)) pin.assets["linux-x64"][1] = sha(bytes);
  const calls = [];
  const original = childProcess.execFileSync;
  childProcess.execFileSync = (command, args) => {
    calls.push({ command, args });
    if (command === "curl") {
      assert.ok(args.includes("Accept: application/octet-stream"));
      assert.equal(args[args.indexOf("--proto-redir") + 1], "=https");
      assert.equal(args[args.indexOf("--retry") + 1], "2");
      assert.ok(!args.some(a => /authorization|token|--user|--netrc|location-trusted/i.test(a)));
      const url = args.find(a => a.startsWith("https://"));
      // Characterize the original HTTP504 browser route; only qualified API works.
      if (url.includes("/releases/download/") || mode === "failed")
        throw new Error("HTTP 504: upstream route unavailable");
      assert.match(url, /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/);
      fs.writeFileSync(args[args.indexOf("--output") + 1], mode === "corrupt" ? "corrupt" : bytes);
      return Buffer.alloc(0);
    }
    assert.equal(command, "tar");
    const out = path.join(args[args.indexOf("-C") + 1], args.at(-1));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, "never executed");
    return Buffer.alloc(0);
  };
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.execFileSync = original;
    syncBuiltinESMExports();
    Object.assign(pins, savedPins);
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "arch", arch);
    fs.rmSync(cache, { recursive: true, force: true });
  });
  return { cache, calls, bytes };
}

test("API bytes pass original checksum/cache admission; cached bytes require no network", t => {
  const { cache, calls } = installerFixture(t, "valid");
  const first = installTools(cache);
  assert.equal(calls.filter(c => c.command === "curl").length, 2);
  assert.equal(calls.filter(c => c.command === "tar").length, 2);
  first.cleanup();
  calls.length = 0;
  installTools(cache).cleanup();
  assert.equal(calls.filter(c => c.command === "curl").length, 0);
  assert.equal(calls.filter(c => c.command === "tar").length, 2);
});
for (const mode of ["failed", "corrupt", "cached-corrupt"])
  test(`${mode} never retries another route or extracts/publishes unverified bytes`, t => {
    const { cache, calls } = installerFixture(t, mode);
    const filename = pins.actionlint.assets["linux-x64"][0];
    if (mode === "cached-corrupt") fs.writeFileSync(path.join(cache, filename), "corrupt");
    assert.throws(() => installTools(cache), mode === "failed" ? /HTTP 504/ : /checksum mismatch/);
    assert.equal(calls.filter(c => c.command === "curl").length, mode === "cached-corrupt" ? 0 : 1);
    assert.equal(calls.filter(c => c.command === "tar").length, 0);
    if (mode !== "cached-corrupt") assert.deepEqual(fs.readdirSync(cache), []);
  });
