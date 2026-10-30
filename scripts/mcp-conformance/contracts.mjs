import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, ".github/scripts/package.json"));
export const { parse, stringify } = require("yaml");
export const revisions = ["2025-11-25", "2026-07-28"];
export const runnerRoot = join(root, ".github/scripts/node_modules/@modelcontextprotocol/conformance");

export function applicable(paths) {
  return paths.some((path) =>
    /^(?:crates\/nac-(?:core|contracts|process|credential-store)\/|crates\/nac-server\/(?:src|tests|examples)\/|scripts\/|\.cargo\/)/u.test(path) ||
    /^crates\/[^/]+\/(?:Cargo.toml|build.rs)$/u.test(path) ||
    ["Cargo.toml", "Cargo.lock", "Makefile", "build.rs", "rust-toolchain", "rust-toolchain.toml",
      "scripts/test-mcp-conformance.sh", "start.sh", "start_dev.sh", ".github/workflows/mcp-conformance.yml",
      ".github/scripts/package.json", ".github/scripts/package-lock.json"].includes(path));
}

export function requirements(revision) {
  if (!revisions.includes(revision)) throw new Error(`unexpected revision: ${revision}`);
  const document = parse(readFileSync(join(runnerRoot, "requirements", `${revision}.yaml`), "utf8"));
  const scored = document.client;
  const unscored = document.not_scored.filter((entry) => entry.leg === "client");
  const names = [...scored, ...unscored.map((entry) => entry.scenario)];
  if (!scored.length || new Set(names).size !== names.length) throw new Error("invalid requirements inventory");
  return { scored, unscored, names };
}

export function baseline(revision) {
  const document = parse(readFileSync(join(root, "scripts/mcp-conformance/expected-failures.yml"), "utf8"));
  if (Object.keys(document).sort().join() !== [...revisions].sort().join()) throw new Error("missing/unexpected baseline revision");
  const entries = document[revision].client;
  if (!Array.isArray(entries) || new Set(entries).size !== entries.length ||
      entries.some((entry) => !/^(?:auth\/[^:]+|elicitation-sep1034-client-defaults):[^:]+$/u.test(entry))) {
    throw new Error("expected failures must name individual deferred OAuth/elicitation checks");
  }
  return entries;
}

function readReports(directory, result = []) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) readReports(path, result);
    else if (item.name === "checks.json") result.push({ path, checks: JSON.parse(readFileSync(path, "utf8")) });
  }
  return result;
}

export function validateResults(revision, directory, receiptsDirectory, expected = baseline(revision)) {
  const inventory = requirements(revision);
  const reports = readReports(directory);
  const receipts = readdirSync(receiptsDirectory).map((name) => JSON.parse(readFileSync(join(receiptsDirectory, name), "utf8")));
  const sameSet = (actual) => actual.length === inventory.names.length && new Set(actual).size === actual.length &&
    actual.every((name) => inventory.names.includes(name));
  const names = reports.map(({ path }) => relative(directory, path).replace(/-\d{4}-\d\d-\d\dT.*\/checks\.json$/u, ""));
  if (!sameSet(names) || !sameSet(receipts.map((receipt) => receipt.scenario))) {
    throw new Error("missing/unexpected/duplicate/skipped scenario inventory or client receipt");
  }
  const permittedSkips = JSON.parse(readFileSync(join(root, "scripts/mcp-conformance/expected-skips.json"), "utf8"))[revision];
  const skips = [];
  const failures = [];
  const outcomes = [];
  for (const [index, report] of reports.entries()) {
    const scenario = names[index];
    const receipt = receipts.find((entry) => entry.scenario === scenario);
    if (receipt.revision !== revision || receipt.error || receipt.signal) throw new Error(`client infrastructure failure: ${scenario}`);
    const deferred = scenario.startsWith("auth/") ? "Error: OAuth client conformance is owned outside ALL-131" :
      scenario === "elicitation-sep1034-client-defaults" ? "Error: interactive elicitation is not implemented by NAC's outbound MCP client" :
      scenario === "json-schema-2020-12-preservation" ?
        "Error: unsupported conformance scenario 'json-schema-2020-12-preservation' (listed tools: json_schema_2020_12_tool, json_schema_echo)" : null;
    if (deferred ? receipt.status !== 1 || receipt.stderr.trim() !== deferred : receipt.status !== 0) {
      throw new Error(`unexpected client exit: ${scenario} (${receipt.status}): ${receipt.stderr}`);
    }
    if (!Array.isArray(report.checks) || !report.checks.length || report.checks.some((check) =>
      !check.id || !["SUCCESS", "FAILURE", "WARNING", "INFO", "SKIPPED"].includes(check.status) ||
      check.id === "wire-schema-harness-error" || check.description === "Failed to run scenario")) {
      throw new Error(`empty/invalid/runner failure checks: ${scenario}`);
    }
    const scored = inventory.scored.includes(scenario);
    for (const check of report.checks) {
      if (check.status === "SKIPPED") skips.push(`${scenario}:${check.id}:${check.name}`);
      if (scored && ["FAILURE", "WARNING"].includes(check.status)) failures.push(`${scenario}:${check.id}`);
    }
    outcomes.push({ scenario, scored, checks: report.checks.length, skipped: report.checks.filter((check) => check.status === "SKIPPED").length, failed: report.checks.filter((check) =>
      ["FAILURE", "WARNING"].includes(check.status)).length, clientExit: receipt.status });
  }
  const expectedSkips = permittedSkips.map((entry) => `${entry.scenario}:${entry.id}:${entry.name}`).sort();
  if (skips.sort().join() !== expectedSkips.join()) throw new Error("unexpected or changed conditional skip inventory");
  const actual = [...new Set(failures)].sort();
  if (actual.join() !== [...expected].sort().join()) {
    throw new Error(`unexpected failures or stale/missing expected checks: ${JSON.stringify(actual.filter((id) => !expected.includes(id)))}; absent: ${JSON.stringify(expected.filter((id) => !actual.includes(id)))}`);
  }
  return outcomes;
}

export function requireComplete(needs, expectedSha) {
  if (Object.keys(needs).sort().join() !== "conformance,prepare" || !/^[0-9a-f]{40}$/u.test(expectedSha ?? "") ||
      needs.prepare?.result !== "success" || needs.prepare.outputs.sha !== expectedSha ||
      !["true", "false"].includes(needs.prepare.outputs.applicable)) throw new Error("invalid candidate/applicability preparation");
  if (needs.conformance?.result !== (needs.prepare.outputs.applicable === "true" ? "success" : "skipped")) {
    throw new Error("applicable MCP conformance did not succeed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "applicability") {
    console.log(`applicable=${applicable(readFileSync(process.argv[3], "utf8").split("\0").filter(Boolean))}`);
  } else if (process.argv[2] === "complete") {
    requireComplete(JSON.parse(process.env.NEEDS_JSON), process.env.EXPECTED_SHA);
    console.log("MCP conformance complete for the exact candidate and applicability");
  } else throw new Error("usage: contracts.mjs applicability <NUL-path-file> | complete");
}
