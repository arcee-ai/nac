import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CONFIG, INPUTS, POLICY, scanSources } from "./source-security.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/security/", import.meta.url));
const now = new Date("2026-10-21T12:00:00Z");
const empty = { schema_version: 1, exceptions: [] };
const exception = {
  advisory: "TEST-ADVISORY",
  package: "npm:handlebars",
  context: INPUTS[1],
  reason: "Fixture only",
  owner: "@fixture-owner",
  linked_issue: "https://linear.app/example/issue/TEST-1",
  expires: "2026-10-22T12:00:00Z",
};

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "nac-source-security-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "candidate");
  const trustedRoot = join(directory, "trusted");
  const output = join(directory, "reports");
  for (const checkout of [root, trustedRoot]) {
    mkdirSync(join(checkout, dirname(POLICY)), { recursive: true });
    writeFileSync(join(checkout, POLICY), JSON.stringify(empty));
    writeFileSync(join(checkout, CONFIG), "# No OSV-level suppressions\n");
  }
  for (const input of INPUTS) {
    mkdirSync(join(root, dirname(input)), { recursive: true });
    copyFileSync(
      join(fixtures, "safe", input === INPUTS[0] ? "Cargo.lock" : "package-lock.json"),
      join(root, input),
    );
  }
  const scanner = join(directory, "scanner");
  // Simulates only the external process boundary; real parser/database fixtures run below.
  const fake = (options = {}) =>
    writeFileSync(
      scanner,
      `#!/usr/bin/env node
    const fs = require('node:fs');
    const options = ${JSON.stringify(options)};
    if (process.argv.includes('--version')) {
      console.log('osv-scanner version: ' + (options.version || '2.7.0')); process.exit(0);
    }
    const args = process.argv.slice(2);
    const input = args[args.indexOf('--lockfile')+1];
    if (!args.includes('--all-packages') || !args.includes('--all-vulns') ||
        !args.includes('--no-call-analysis=go,rust') || !args.includes('--config') ||
        !fs.readFileSync(args[args.indexOf('--config')+1], 'utf8').startsWith('#')) process.exit(127);
    const cargo = input.endsWith('Cargo.lock');
    const vulnerable = fs.readFileSync(input,'utf8').includes(cargo ? 'rustls' : 'handlebars');
    const package = { name: cargo ? (vulnerable ? 'rustls' : 'itoa') : (vulnerable ? 'handlebars' : 'is-number'),
      version: '1.0.0', ecosystem: cargo ? 'crates.io' : 'npm' };
    const vulnerabilities = vulnerable ? [{ id: 'TEST-ADVISORY', affected: [{ package, ranges: [{ events: [{ fixed: '2.0.0' }] }] }] }] : [];
    const result = {results:[{source:{type:'lockfile', path:input}, packages:[{package,vulnerabilities}]}]};
    if (options.empty) result.results[0].packages = [];
    if (options.wrongPath) result.results[0].source.path = '/wrong/Cargo.lock';
    if (!options.noReport) fs.writeFileSync(args[args.indexOf('--output-file')+1], options.malformed ? '{' : JSON.stringify(result));
    if (options.diagnostic) console.error('API request failed');
    process.exit(options.status ?? (vulnerable ? 1 : 0));
  `,
      { mode: 0o755 },
    );
  fake();
  return { directory, root, trustedRoot, output, scanner, now, fake };
}

function vulnerable(w, context) {
  copyFileSync(
    join(fixtures, "vulnerable", context === INPUTS[0] ? "Cargo.lock" : "package-lock.json"),
    join(w.root, context),
  );
}

test("safe locked Rust and both npm inputs pass with explicit central config and full graph flags", (t) => {
  const w = workspace(t);
  const report = scanSources(w);
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.deepEqual(
    report.inputs.map((input) => input.context),
    INPUTS,
  );
  assert.ok(
    report.inputs.every((input) => input.packages > 0 && /^[a-f0-9]{64}$/u.test(input.sha256)),
  );
});

for (const context of INPUTS) {
  test(`unsuppressed vulnerable graph fails: ${context}`, (t) => {
    const w = workspace(t);
    vulnerable(w, context);
    const report = scanSources(w);
    assert.equal(report.passed, false, JSON.stringify(report));
    assert.equal(report.errors.length, 0);
    assert.equal(report.blocking[0].context, context);
    assert.equal(report.blocking[0].advisory, "TEST-ADVISORY");
    assert.deepEqual(report.blocking[0].fixed, ["2.0.0"]);
  });
}

test("previously reviewed unexpired exception applies; PR-authored suppression cannot self-clear", (t) => {
  const w = workspace(t);
  vulnerable(w, INPUTS[1]);
  const policy = JSON.stringify({ schema_version: 1, exceptions: [exception] });
  writeFileSync(join(w.root, POLICY), policy);
  assert.match(scanSources(w).errors.join(), /differs from trusted base/u);
  writeFileSync(join(w.trustedRoot, POLICY), policy);
  assert.equal(scanSources(w).passed, true);
  assert.equal(scanSources(w).excepted.length, 1);
  vulnerable(w, INPUTS[2]);
  const report = scanSources(w);
  assert.equal(report.passed, false);
  assert.equal(report.blocking[0].context, INPUTS[2]);
});

for (const failure of [
  "missing input",
  "missing policy",
  "malformed policy",
  "expired policy",
  "malformed config",
  "broad config",
  "symlink input",
]) {
  test(`${failure} fails closed and retains a report`, (t) => {
    const w = workspace(t);
    if (failure === "missing input") rmSync(join(w.root, INPUTS[2]));
    if (failure === "missing policy") rmSync(join(w.trustedRoot, POLICY));
    if (failure === "malformed policy") writeFileSync(join(w.trustedRoot, POLICY), "{");
    if (failure === "expired policy")
      writeFileSync(
        join(w.trustedRoot, POLICY),
        JSON.stringify({
          schema_version: 1,
          exceptions: [{ ...exception, expires: "2026-10-20T00:00:00Z" }],
        }),
      );
    if (failure === "malformed config") writeFileSync(join(w.trustedRoot, CONFIG), "[[broken");
    if (failure === "broad config")
      writeFileSync(join(w.trustedRoot, CONFIG), "[[PackageOverrides]]\nignore = true\n");
    if (failure === "symlink input") {
      rmSync(join(w.root, INPUTS[0]));
      symlinkSync(join(fixtures, "safe/Cargo.lock"), join(w.root, INPUTS[0]));
    }
    const report = scanSources(w);
    assert.equal(report.passed, false);
    assert.ok(report.errors.length > 0);
    assert.equal(JSON.parse(readFileSync(join(w.output, "source-security.json"))).passed, false);
    assert.match(readFileSync(join(w.output, "source-security.md"), "utf8"), /FAIL/u);
  });
}

for (const options of [
  { status: 127 },
  { status: 128 },
  { status: 129 },
  { status: 130 },
  { status: 1 },
  { malformed: true },
  { empty: true },
  { wrongPath: true },
  { version: "2.8.0" },
]) {
  test(`infrastructure/report error fails closed: ${JSON.stringify(options)}`, (t) => {
    const w = workspace(t);
    w.fake(options);
    assert.equal(scanSources(w).passed, false);
    assert.ok(scanSources(w).errors.length > 0);
  });
}

test("findings plus logged infrastructure error cannot pass through reviewed exception", (t) => {
  const w = workspace(t);
  vulnerable(w, INPUTS[1]);
  for (const checkout of [w.root, w.trustedRoot]) {
    writeFileSync(
      join(checkout, POLICY),
      JSON.stringify({ schema_version: 1, exceptions: [exception] }),
    );
  }
  w.fake({ diagnostic: true });
  assert.match(scanSources(w).errors.join(), /error diagnostics/u);
});

test("missing scanner fails closed", (t) => {
  const w = workspace(t);
  rmSync(w.scanner);
  assert.match(scanSources(w).errors.join(), /infrastructure failure/u);
});

test("a failed process cannot reuse a stale previously excepted report", (t) => {
  const w = workspace(t);
  vulnerable(w, INPUTS[1]);
  for (const checkout of [w.root, w.trustedRoot]) {
    writeFileSync(
      join(checkout, POLICY),
      JSON.stringify({ schema_version: 1, exceptions: [exception] }),
    );
  }
  assert.equal(scanSources(w).passed, true);
  w.fake({ noReport: true });
  const report = scanSources(w);
  assert.equal(report.passed, false);
  assert.ok(report.errors.length > 0);
});

test("installer rejects mismatched binary digest before installation", (t) => {
  const w = workspace(t);
  const curl = join(w.directory, "curl");
  writeFileSync(
    curl,
    '#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\nprintf bad-binary > "$2"\n',
    { mode: 0o755 },
  );
  const result = spawnSync(
    "sh",
    [
      fileURLToPath(new URL("./install-osv-scanner.sh", import.meta.url)),
      join(w.directory, "installed"),
    ],
    { env: { ...process.env, PATH: `${w.directory}:${process.env.PATH}` }, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/u);
});

test(
  "real pinned OSV parses safe Rust/both npm and rejects each vulnerable input",
  {
    skip:
      !process.env.OSV_SCANNER &&
      "set OSV_SCANNER to verified pinned binary for live fixture qualification",
    timeout: 600_000,
  },
  (t) => {
    const w = workspace(t);
    w.scanner = resolve(process.env.OSV_SCANNER);
    const safe = scanSources(w);
    assert.equal(safe.passed, true, JSON.stringify(safe));
    for (const context of INPUTS) {
      vulnerable(w, context);
      const report = scanSources(w);
      assert.equal(report.passed, false);
      assert.deepEqual(report.errors, []);
      assert.ok(report.blocking.some((finding) => finding.context === context));
      copyFileSync(
        join(fixtures, "safe", context === INPUTS[0] ? "Cargo.lock" : "package-lock.json"),
        join(w.root, context),
      );
    }
  },
);
