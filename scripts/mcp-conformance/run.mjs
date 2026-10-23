import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { root, runnerRoot, revisions, baseline, stringify, validateResults } from "./contracts.mjs";

const output = resolve(process.env.MCP_CONFORMANCE_OUTPUT ?? join(root, "target/mcp-conformance", new Date().toISOString().replaceAll(":", "-")));
mkdirSync(output, { recursive: false });
const started = performance.now();
const receipt = { candidate: null, node: process.version, revisions: [], passed: false };
const hash = (path) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
function command(file, args, name, options = {}) {
  const start = performance.now();
  const result = spawnSync(file, args, { cwd: root, encoding: "utf8", timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024, ...options });
  writeFileSync(join(output, `${name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  return { ...result, seconds: (performance.now() - start) / 1000 };
}
function successful(result, name) {
  if (result.error || result.signal || result.status !== 0) throw new Error(`${name} failed: ${result.error?.message ?? result.signal ?? result.status}; see ${output}`);
}
// The official CLI executes this command through a shell; quote only our known paths.
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
try {
  const identity = command("git", ["rev-parse", "HEAD"], "identity");
  successful(identity, "candidate identity");
  receipt.candidate = identity.stdout.trim();
  receipt.lockSha256 = hash(".github/scripts/package-lock.json");
  receipt.cargoLockSha256 = hash("Cargo.lock");
  receipt.baselineSha256 = hash("scripts/mcp-conformance/expected-failures.yml");
  const manifest = JSON.parse(readFileSync(join(runnerRoot, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, ".github/scripts/package-lock.json"), "utf8"));
  if (manifest.version !== "0.2.0-alpha.11" || lock.packages["node_modules/@modelcontextprotocol/conformance"].version !== manifest.version) {
    throw new Error("installed runner does not match the pinned lock; run make setup");
  }
  receipt.runner = `${manifest.name}@${manifest.version}`;
  const cargo = process.env.CARGO ?? "cargo";
  const toolchain = command(cargo, ["--version"], "cargo-version");
  successful(toolchain, "Cargo version");
  receipt.cargo = toolchain.stdout.trim();
  const build = command(cargo, ["build", "--locked", "--manifest-path", join(root, "Cargo.toml"), "-p", "nac-core",
    "--features", "test-support", "--example", "mcp_conformance_client", "--message-format=json"], "build", { timeout: 900_000 });
  successful(build, "locked client build");
  receipt.buildSeconds = build.seconds;
  const artifacts = build.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) =>
    entry.reason === "compiler-artifact" && entry.target.name === "mcp_conformance_client" && entry.executable);
  if (artifacts.length !== 1) throw new Error("missing/ambiguous client executable");
  const client = artifacts[0].executable;
  receipt.clientSha256 = createHash("sha256").update(readFileSync(client)).digest("hex");
  receipt.platform = process.platform;
  receipt.architecture = process.arch;
  const cli = join(runnerRoot, "dist/index.js");
  const clientCommand = `${quote(process.execPath)} ${quote(join(root, "scripts/mcp-conformance/client-launch.mjs"))}`;
  const environment = { ...process.env, NAC_MCP_CLIENT: client, NAC_MCP_SEED: "" };
  for (const revision of revisions) {
    const directory = join(output, revision);
    const receipts = join(output, `${revision}-clients`);
    mkdirSync(receipts);
    const expected = join(output, `${revision}-expected.yml`);
    writeFileSync(expected, stringify({ client: baseline(revision) }));
    const run = command(process.execPath, [cli, "client", "--command", clientCommand, "--requirements", revision,
      "--expected-failures", expected, "--output-dir", directory], revision,
    { env: { ...environment, NAC_MCP_RECEIPTS: receipts } });
    successful(run, `${revision} official runner`);
    const outcomes = validateResults(revision, directory, receipts);
    receipt.revisions.push({ revision, seconds: run.seconds, requirementsSha256: createHash("sha256")
      .update(readFileSync(join(runnerRoot, "requirements", `${revision}.yaml`))).digest("hex"), outcomes });
    console.log(`${revision}: ${outcomes.length} scenarios validated in ${run.seconds.toFixed(2)}s`);
  }
  if (process.argv.includes("--seed")) {
    const directory = join(output, "seed-omit-tool-call");
    const receipts = join(output, "seed-clients");
    mkdirSync(receipts);
    const seed = command(process.execPath, [cli, "client", "--command", clientCommand, "--scenario", "tools_call",
      "--spec-version", "2026-07-28", "--output-dir", directory], "seed",
    { env: { ...environment, NAC_MCP_RECEIPTS: receipts, NAC_MCP_SEED: "omit-tool-call" } });
    const { readdirSync } = await import("node:fs");
    const checks = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0], "checks.json"), "utf8"));
    const child = JSON.parse(readFileSync(join(receipts, "tools_call.json"), "utf8"));
    if (seed.error || seed.signal || seed.status !== 1 || child.status !== 0 || child.error || child.signal ||
        !checks.some((check) => check.id === "tool-add-numbers" && check.status === "FAILURE")) {
      throw new Error("seed did not fail the exact missing add_numbers contract with a successful client");
    }
    receipt.seed = { name: "omit-tool-call", detected: true, seconds: seed.seconds, check: "tool-add-numbers" };
    console.log("Seeded omitted tool call correctly failed tool-add-numbers; client exited successfully");
  }
  receipt.passed = receipt.revisions.map((entry) => entry.revision).join() === revisions.join();
} catch (error) {
  receipt.error = error.message;
  console.error(error);
  process.exitCode = 1;
} finally {
  receipt.seconds = (performance.now() - started) / 1000;
  writeFileSync(join(output, "summary.json"), JSON.stringify(receipt, null, 2));
  console.log(`Conformance evidence: ${output}`);
}
