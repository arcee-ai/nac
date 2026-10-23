import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applicable, revisions, requirements, baseline, validateResults, requireComplete, parse, root } from "./contracts.mjs";

function fixture(revision = "2026-07-28") {
  const directory = mkdtempSync(join(tmpdir(), "nac-mcp-contract-"));
  const results = join(directory, "results");
  const receipts = join(directory, "receipts");
  mkdirSync(results);
  mkdirSync(receipts);
  const skips = JSON.parse(readFileSync(join(root, "scripts/mcp-conformance/expected-skips.json"), "utf8"))[revision];
  for (const scenario of requirements(revision).names) {
    const path = join(results, `${scenario}-2026-10-23T00-00-00-000Z`);
    mkdirSync(path, { recursive: true });
    const checks = [{ id: "example-pass", name: "ExamplePass", status: "SUCCESS" },
      ...baseline(revision).filter((entry) => entry.startsWith(`${scenario}:`)).map((entry) => ({
        id: entry.slice(scenario.length + 1), name: entry, status: "FAILURE" })),
      ...skips.filter((entry) => entry.scenario === scenario).map((entry) => ({ ...entry, status: "SKIPPED" }))];
    writeFileSync(join(path, "checks.json"), JSON.stringify(checks));
    const deferred = scenario.startsWith("auth/") ? "Error: OAuth client conformance is owned outside ALL-131" :
      scenario === "elicitation-sep1034-client-defaults" ? "Error: interactive elicitation is not implemented by NAC's outbound MCP client" :
      scenario === "json-schema-2020-12-preservation" ? "Error: unsupported conformance scenario 'json-schema-2020-12-preservation' (listed tools: json_schema_2020_12_tool, json_schema_echo)" : "";
    writeFileSync(join(receipts, `${encodeURIComponent(scenario)}.json`), JSON.stringify({ scenario, revision,
      status: deferred ? 1 : 0, signal: null, error: null, stderr: deferred }));
  }
  const checkPath = (scenario) => join(results, `${scenario}-2026-10-23T00-00-00-000Z`, "checks.json");
  return { directory, results, receipts, checkPath,
    updateChecks(scenario, change) { const path = checkPath(scenario); writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8"))))); },
    updateReceipt(scenario, change) { const path = join(receipts, `${encodeURIComponent(scenario)}.json`);
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...change })); },
  };
}

for (const [revision, scored, total] of [[revisions[0], 18, 25], [revisions[1], 32, 39]]) {
  test(`${revision}: full frozen inventory and individual known failures pass`, () => {
    const f = fixture(revision);
    try {
      assert.equal(requirements(revision).scored.length, scored);
      assert.equal(validateResults(revision, f.results, f.receipts).length, total);
    } finally { rmSync(f.directory, { recursive: true }); }
  });
}

test("unknown revision is rejected", () => assert.throws(() => requirements("draft"), /unexpected revision/u));

const mutations = {
  "missing scenario": (f) => rmSync(f.checkPath("tools_call")),
  "missing client receipt": (f) => rmSync(join(f.receipts, "tools_call.json")),
  "wrong revision": (f) => f.updateReceipt("tools_call", { revision: "2025-11-25" }),
  "empty checks despite successful runner exit": (f) => f.updateChecks("tools_call", () => []),
  "unexpected failure": (f) => f.updateChecks("tools_call", (checks) => [...checks, { id: "regression", status: "FAILURE" }]),
  "unexpected warning": (f) => f.updateChecks("tools_call", (checks) => [...checks, { id: "regression", status: "WARNING" }]),
  "unexpected conditional skip": (f) => f.updateChecks("tools_call", (checks) => [...checks, { id: "regression", name: "Regression", status: "SKIPPED" }]),
  "missing known conditional skip": (f) => f.updateChecks("request-metadata", (checks) => checks.filter((check) => check.status !== "SKIPPED")),
  "stale expected failure": (f) => f.updateChecks("auth/metadata-default", (checks) => checks.map((check) => ({ ...check, status: "SUCCESS" }))),
  "missing expected check": (f) => f.updateChecks("auth/metadata-default", (checks) => checks.filter((check) => check.status === "SUCCESS")),
  "runner failure in baselined scenario": (f) => f.updateChecks("auth/metadata-default", (checks) => [...checks, { id: "auth/metadata-default", status: "FAILURE", description: "Failed to run scenario" }]),
  "wire harness error": (f) => f.updateChecks("auth/metadata-default", (checks) => [...checks, { id: "wire-schema-harness-error", status: "FAILURE" }]),
  "missing executable in baselined scenario": (f) => f.updateReceipt("auth/metadata-default", { status: 127, stderr: "not found" }),
  "timeout": (f) => f.updateReceipt("auth/metadata-default", { signal: "SIGTERM", error: "ETIMEDOUT" }),
  "panic cannot match deferred error": (f) => f.updateReceipt("auth/metadata-default", { stderr: "Error: OAuth client conformance is owned outside ALL-131\npanic" }),
  "unscored infrastructure failure": (f) => f.updateReceipt("auth/dpop", { status: 2, stderr: "port unavailable" }),
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`reject ${name}`, () => {
    const f = fixture();
    try { mutate(f); assert.throws(() => validateResults(revisions[1], f.results, f.receipts)); }
    finally { rmSync(f.directory, { recursive: true }); }
  });
}

test("applicability covers shared contracts, adapters, delivery and build inputs", () => {
  for (const path of ["crates/nac-core/src/mcp/mod.rs", "crates/nac-core/src/tools/registry.rs",
    "crates/nac-contracts/src/lib.rs", "crates/nac-process/src/lib.rs", "crates/nac-credential-store/src/lib.rs",
    "crates/nac-server/src/mcp.rs", "crates/nac-server/src/tools/schema.rs", "crates/nac-server/tests/mcp.rs",
    "crates/nac-managed/Cargo.toml", "Cargo.lock", "Cargo.toml", "rust-toolchain.toml", ".cargo/config.toml",
    "Makefile", "scripts/build.sh", "start_dev.sh", ".github/scripts/package-lock.json",
    ".github/workflows/mcp-conformance.yml", "scripts/mcp-conformance/expected-failures.yml",
    "crates/nac-core/src/odd\nname.rs"]) assert.equal(applicable([path]), true, path);
  for (const path of ["docs/guide.md", "README.md", "crates/nac-server/web/src/main.tsx",
    "crates/nac-server/assets/dist/index.js", "docker/managed/Dockerfile", ".github/workflows/cla.yml"]) {
    assert.equal(applicable([path]), false, path);
  }
  assert.equal(applicable([]), false);
});

test("exact result contract rejects failure, cancellation, missing, skipped and stale identity", () => {
  const sha = "a".repeat(40);
  const needs = { prepare: { result: "success", outputs: { sha, applicable: "true" } }, conformance: { result: "success" } };
  requireComplete(needs, sha);
  for (const result of ["failure", "cancelled", "skipped", "neutral", undefined]) {
    assert.throws(() => requireComplete({ ...needs, conformance: { result } }, sha));
  }
  assert.throws(() => requireComplete(needs, "b".repeat(40)));
  assert.throws(() => requireComplete({ ...needs, extra: { result: "success" } }, sha));
  for (const applicable of [undefined, "", "TRUE"]) assert.throws(() => requireComplete({ ...needs,
    prepare: { ...needs.prepare, outputs: { sha, applicable } } }, sha));
  const omitted = { ...needs, prepare: { ...needs.prepare, outputs: { sha, applicable: "false" } }, conformance: { result: "skipped" } };
  requireComplete(omitted, sha);
  assert.throws(() => requireComplete({ ...omitted, conformance: { result: "success" } }, sha));
});

test("dedicated workflow keeps immutable candidates, explicit applicability and terminal dependencies", () => {
  const workflow = parse(readFileSync(join(root, ".github/workflows/mcp-conformance.yml"), "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "schedule", "workflow_dispatch"]);
  assert.equal(workflow.on.pull_request.paths, undefined);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.complete.needs, ["prepare", "conformance"]);
  assert.equal(workflow.jobs.complete.if, "always()");
  assert.equal(workflow.jobs.conformance.if, "needs.prepare.outputs.applicable == 'true'");
  assert.equal(workflow.jobs.conformance.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.equal(workflow.jobs.prepare.steps[0].with.ref, "${{ github.sha }}");
  assert.ok(workflow.jobs.prepare.steps.some((step) => step.run?.includes("git diff --no-renames --name-only -z")));
  assert.ok(workflow.jobs.conformance.steps.some((step) => step.run?.includes("make test-mcp-conformance")));
});

test("client launcher records ENOENT independently of upstream checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "nac-mcp-missing-"));
  try {
    const result = spawnSync(process.execPath, [join(root, "scripts/mcp-conformance/client-launch.mjs"), "http://localhost:1"], {
      env: { ...process.env, MCP_CONFORMANCE_SCENARIO: "auth/metadata-default", MCP_CONFORMANCE_PROTOCOL_VERSION: revisions[1],
        NAC_MCP_RECEIPTS: directory, NAC_MCP_CLIENT: join(directory, "missing-client") }, encoding: "utf8" });
    assert.equal(result.status, 2);
    const receipt = JSON.parse(readFileSync(join(directory, "auth%2Fmetadata-default.json"), "utf8"));
    assert.match(receipt.error, /ENOENT/u);
    assert.equal(receipt.status, null);
  } finally { rmSync(directory, { recursive: true }); }
});

test("launcher normalizes inherited Rust diagnostics before exact rejection checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "nac-mcp-backtrace-"));
  try {
    const client = join(directory, "environment-client.mjs");
    writeFileSync(client, 'console.log(JSON.stringify({backtrace:process.env.RUST_BACKTRACE,lib:process.env.RUST_LIB_BACKTRACE}));');
    const result = spawnSync(process.execPath, [join(root, "scripts/mcp-conformance/client-launch.mjs"), client], {
      env: { ...process.env, RUST_BACKTRACE: "full", RUST_LIB_BACKTRACE: "1", MCP_CONFORMANCE_SCENARIO: "tools_call",
        MCP_CONFORMANCE_PROTOCOL_VERSION: revisions[1], NAC_MCP_RECEIPTS: directory, NAC_MCP_CLIENT: process.execPath },
      encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { backtrace: "0", lib: "0" });
    const receipt = JSON.parse(readFileSync(join(directory, "tools_call.json"), "utf8"));
    assert.equal(receipt.status, 0);
    assert.equal(receipt.stderr, "");
  } finally { rmSync(directory, { recursive: true }); }
});
