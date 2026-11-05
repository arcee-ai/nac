import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { requiredJobs } from "./pr-checks.mjs";

const YAML = createRequire(import.meta.url)("yaml");
const stable = YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));
const rust = "dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0";
const upload = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const download = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";
const trustedWrite = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
const sourceMode = "steps.binary.outputs.mode == 'source'";
const compilerGroup = "server-browser-linux-gnu-debug0-v1";
const compilerRoles = ["test-server", "browser-binary", "browser-proof", "browser-shards"];
const compilerPrefix = "${{ needs.prepare.outputs.cold_caches == 'true' && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}";
const step = (job, id) => job.steps.find(s => s.id === id);
const named = (job, name) => job.steps.find(s => s.name === name);

function compilerCacheGroup(config) {
  const caches = Object.entries(config.jobs).flatMap(([job, value]) => (value.steps ?? [])
    .filter(s => s.uses?.startsWith("Swatinem/rust-cache@")).map(cache => ({ job, value, cache })));
  assert.deepEqual(caches.filter(({ cache }) => cache.with["shared-key"] === compilerGroup)
    .map(({ job }) => job).sort(), [...compilerRoles].sort(), "exactly four measured default-feature roles share");
  for (const { job, value, cache } of caches) {
    if (!compilerRoles.includes(job)) {
      assert.notEqual(cache.with["shared-key"], compilerGroup);
      continue;
    }
    assert.equal(cache.uses, "Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4");
    assert.deepEqual(cache.with, {
      "prefix-key": compilerPrefix, "shared-key": compilerGroup,
      "save-if": job === "test-server" ? trustedWrite : "false",
    }, "one trusted writer, no key override, default environment hashing and workspace pruning");
    assert.equal(cache.if, ["browser-proof", "browser-shards"].includes(job) ? sourceMode : undefined);
    assert.equal(cache["continue-on-error"], undefined);
    assert.equal(value["runs-on"], "ubuntu-latest");
    assert.equal(value.env.CARGO_PROFILE_DEV_DEBUG, "0");
    assert.equal(value.env.CARGO_PROFILE_TEST_DEBUG, "0");
    // Pinned restore exports zero before key construction. Browser runtime
    // keeps its explicit zero even on the normal no-cache artifact path.
    assert.equal(value.env.CARGO_INCREMENTAL, job === "test-server" ? undefined : "0");
    assert.ok(value.steps.some(s => s.uses === rust));
  }
  assert.equal(named(config.jobs["test-server"], "Run nac-server tests").run,
    "python3 .github/scripts/server-tests.py");
  assert.match(step(config.jobs["browser-binary"], "pack").run,
    /^cargo build --locked -p nac-server --bin nac-web$/m);
  for (const role of ["browser-proof", "browser-shards"]) {
    assert.equal(named(config.jobs[role], "Rebuild current-attempt source after a valid older producer").run,
      "cargo build --locked -p nac-server --bin nac-web");
  }
}

function profile(job) {
  assert.equal(job.env.CARGO_PROFILE_DEV_DEBUG, "0");
  assert.equal(job.env.CARGO_PROFILE_TEST_DEBUG, "0");
  assert.equal(job.env.CARGO_INCREMENTAL, "0", "normal artifact consumers retain the original Cargo runtime setting");
  assert.equal(job.env.NAC_SOURCE_REVISION, "${{ needs.prepare.outputs.sha }}");
  assert.equal(job.env.NAC_BUILD_TRACK, "dev");
  assert.equal(job.env.NAC_BUILD_ID, "dev-${{ needs.prepare.outputs.sha }}");
  assert.equal(job.env.ImageOS, undefined);
  assert.equal(job.env.ImageVersion, undefined);
  assert.equal(job.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.ok(job.steps.some(s => s.uses === rust), "keep pinned Rust even when no source rebuild is needed");
  for (const s of job.steps) assert.equal(s["continue-on-error"], undefined);
  assert.equal(job.permissions, undefined);
}

function identityArguments(run) {
  for (const fragment of [
    '--source "$NAC_SOURCE_REVISION" --repository "$GITHUB_REPOSITORY"',
    '--run-id "$GITHUB_RUN_ID" --attempt "$GITHUB_RUN_ATTEMPT"',
    '--target x86_64-unknown-linux-gnu --rustc "$(rustc --version)"',
    '--runner-image "$ImageOS@$ImageVersion" --github-output "$GITHUB_OUTPUT"',
  ]) assert.ok(run.includes(fragment), fragment);
  assert.doesNotMatch(run, /\|\|\s*true|continue-on-error|quality-receipt|verify-quality/);
}

function validate(config, required = requiredJobs) {
  compilerCacheGroup(config);
  assert.equal(config.permissions.contents, "read");
  const producer = config.jobs["browser-binary"];
  assert.equal(producer.needs, "prepare");
  assert.equal(producer.if, "${{ needs.prepare.outputs.run == 'true' }}");
  profile(producer);
  assert.deepEqual(producer.outputs, {
    receipt: "${{ steps.pack.outputs.receipt }}",
    artifact_id: "${{ steps.upload.outputs.artifact-id }}",
  });
  const pack = step(producer, "pack");
  assert.equal(pack.if, undefined);
  assert.match(pack.run, /\$\{ImageOS:\?missing runner OS\}.*\$\{ImageVersion:\?missing runner image version\}/);
  assert.match(pack.run, /test "\$\(git rev-parse HEAD\)" = "\$NAC_SOURCE_REVISION"/);
  assert.match(pack.run, /cargo build --locked -p nac-server --bin nac-web/);
  assert.match(pack.run, /browser-binary.py pack/);
  identityArguments(pack.run);
  const retain = step(producer, "upload");
  assert.equal(retain.uses, upload);
  assert.equal(retain.if, undefined);
  assert.deepEqual(retain.with, {
    name: "browser-binary-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
    path: "${{ steps.pack.outputs.archive }}", "compression-level": 0,
    "retention-days": 7, "if-no-files-found": "error",
  });
  for (const name of ["browser-shards", "browser-proof"]) {
    const consumer = config.jobs[name];
    assert.deepEqual(consumer.needs, ["prepare", "browser-binary"]);
    profile(consumer);
    const guard = named(consumer, "Validate browser artifact selection and current runner");
    assert.equal(guard.if, undefined);
    assert.equal(guard.env.BROWSER_ARTIFACT_ID, "${{ needs.browser-binary.outputs.artifact_id }}");
    assert.equal(guard.env.BROWSER_BINARY_RECEIPT, "${{ needs.browser-binary.outputs.receipt }}");
    assert.match(guard.run, /\$\{ImageOS:\?missing runner OS\}.*\$\{ImageVersion:\?missing runner image version\}/);
    assert.ok(guard.run.includes('[[ "$BROWSER_ARTIFACT_ID" =~ ^[1-9][0-9]*$ ]]'));
    assert.ok(guard.run.includes('test -n "$BROWSER_BINARY_RECEIPT"'));
    assert.ok(guard.run.includes('printf \'Browser consumer runner image: %s@%s\\n\' "$ImageOS" "$ImageVersion"'));
    assert.ok(guard.run.includes('mkdir "$GITHUB_WORKSPACE/browser-binary-download"'));
    const fetch = consumer.steps.find(s => s.uses === download);
    assert.ok(consumer.steps.indexOf(guard) < consumer.steps.indexOf(fetch));
    assert.equal(fetch.if, undefined);
    assert.deepEqual(fetch.with, {
      "artifact-ids": "${{ needs.browser-binary.outputs.artifact_id }}",
      path: "browser-binary-download", "merge-multiple": true,
    });
    const admit = step(consumer, "binary");
    assert.equal(admit.if, undefined);
    assert.deepEqual(admit.env, { BROWSER_BINARY_RECEIPT: "${{ needs.browser-binary.outputs.receipt }}" });
    assert.match(admit.run, /browser-binary.py consume/);
    assert.match(admit.run, /--receipt-env BROWSER_BINARY_RECEIPT/);
    identityArguments(admit.run);
    const cache = consumer.steps.find(s => s.uses?.startsWith("Swatinem/rust-cache@"));
    const rebuild = named(consumer, "Rebuild current-attempt source after a valid older producer");
    assert.equal(cache.if, sourceMode);
    assert.equal(cache.with["save-if"], "false");
    assert.equal(cache.with["prefix-key"], "${{ needs.prepare.outputs.cold_caches == 'true' && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}");
    assert.equal(rebuild.if, sourceMode);
    assert.equal(rebuild.run, "cargo build --locked -p nac-server --bin nac-web");
    assert.ok(consumer.steps.indexOf(admit) < consumer.steps.indexOf(cache));
    assert.ok(consumer.steps.indexOf(cache) < consumer.steps.indexOf(rebuild));
    const runtime = step(consumer, "runtime");
    assert.equal(runtime.env.BROWSER_BINARY_MODE, "${{ steps.binary.outputs.mode }}");
    assert.equal(runtime.env.VERIFIED_BROWSER_BINARY, "${{ steps.binary.outputs.binary }}");
    const execute = consumer.steps.find(s => s.run?.includes("run test:e2e"));
    assert.equal(execute.env.NAC_E2E_BINARY, "${{ steps.runtime.outputs.binary }}");
    assert.ok(consumer.steps.indexOf(runtime) < consumer.steps.indexOf(execute));
    assert.equal(consumer.steps.filter(s => s.run?.includes("cargo build")).length, 1,
      "only the conditional source rebuild may compile in consumers");
  }
  const proof = config.jobs["browser-proof"];
  const stage = named(proof, "Stage only the two bounded ALL471 goal receipts");
  assert.equal(stage.env.NAC_E2E_BINARY, "${{ steps.runtime.outputs.binary }}");
  assert.ok(stage.run.indexOf("browser-proof.py") < stage.run.indexOf("browser-binary.py verify-proof"));
  assert.match(stage.run, /browser-binary.py verify-proof/);
  assert.match(stage.run, /--binary "\$NAC_E2E_BINARY" --source "\$GOAL_PROOF_SOURCE"/);
  const proofArtifact = named(proof, "Retain only ALL471 goal proof and cleanup receipts");
  assert.equal(proofArtifact.with.name,
    "all471-goal-proof-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}");
  assert.equal(proofArtifact.with.overwrite, undefined, "retain earlier successful proof attempts");
  assert.deepEqual(config.jobs.browser.needs, ["prepare", "browser-binary", "browser-shards", "browser-proof"]);
  assert.equal(config.jobs.browser.steps[0].env.BINARY_RESULT, "${{ needs.browser-binary.result }}");
  assert.match(config.jobs.browser.steps[0].run, /test "\$BINARY_RESULT" = success/);
  assert.ok(required.includes("browser-binary"));
  assert.ok(config.jobs["required-pr-checks"].needs.includes("browser-binary"));
  for (const job of [producer, config.jobs["browser-shards"], proof]) {
    for (const cache of job.steps.filter(s => s.uses?.startsWith("Swatinem/rust-cache@"))) {
      assert.equal(cache.with["save-if"], "false");
    }
  }
}

test("parsed same-run browser producer and consumers preserve identity, runtime and retry contracts", () => validate(stable));

test("narrow compiler cache rejects extra roles, writers, profiles, flags and weakened cache policy", () => {
  compilerCacheGroup(stable);
  const cache = (w, job) => w.jobs[job].steps.find(s => s.uses?.startsWith("Swatinem/rust-cache@"));
  const mutations = [
    w => { delete cache(w, "test-server").with["shared-key"]; },
    w => { cache(w, "browser-binary").with.key = "ignored-reader-suffix"; },
    w => { cache(w, "browser-binary").with["save-if"] = trustedWrite; },
    w => { cache(w, "browser-proof").with["save-if"] = false; },
    w => { cache(w, "test-server").with["save-if"] = "true"; },
    w => { cache(w, "browser-shards").with["add-rust-environment-hash-key"] = false; },
    w => { cache(w, "browser-binary").with["cache-workspace-crates"] = true; },
    w => { cache(w, "test-server").with["cache-on-failure"] = true; },
    w => { cache(w, "browser-proof").with["prefix-key"] = "nac-ci-v1"; },
    w => { delete cache(w, "browser-shards").if; },
    w => { w.jobs["test-workspace"].steps.find(s => s.uses?.startsWith("Swatinem/")).with["shared-key"] = compilerGroup; },
    w => { cache(w, "test-core").with["shared-key"] = compilerGroup; },
    w => { cache(w, "lint").with["shared-key"] = compilerGroup; },
    w => { w.jobs["test-server"].env.CARGO_PROFILE_DEV_DEBUG = "2"; },
    w => { named(w.jobs["test-server"], "Run nac-server tests").run += " --all-features"; },
    w => { step(w.jobs["browser-binary"], "pack").run = step(w.jobs["browser-binary"], "pack").run.replace(
      "cargo build --locked -p nac-server --bin nac-web", "cargo build --locked -p nac-server --bin nac-web --features managed-fault-fixture"); },
    w => { w.jobs["browser-proof"].steps.push(structuredClone(cache(w, "browser-proof"))); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const broken = structuredClone(stable); mutate(broken);
    assert.throws(() => compilerCacheGroup(broken), undefined, `compiler group mutation ${index}`);
  }
});

test("seeded producer, digest-origin, fallback, runtime and required-DAG regressions are rejected", () => {
  const mutations = [
    w => delete w.jobs["browser-binary"],
    w => { w.jobs["browser-binary"].outputs.receipt = "${{ inputs.receipt }}"; },
    w => { w.jobs["browser-binary"].outputs.artifact_id = "0"; },
    w => { w.jobs["browser-binary"].env.NAC_SOURCE_REVISION = "${{ github.sha }}"; },
    w => { w.jobs["browser-binary"].env.CARGO_PROFILE_DEV_DEBUG = "2"; },
    w => { step(w.jobs["browser-binary"], "upload").with.name = "previous-green"; },
    w => { step(w.jobs["browser-binary"], "upload").with["compression-level"] = 6; },
    w => { named(w.jobs["browser-shards"], "Validate browser artifact selection and current runner").run = "true"; },
    w => { delete named(w.jobs["browser-shards"], "Validate browser artifact selection and current runner").env.BROWSER_BINARY_RECEIPT; },
    w => { const guard = named(w.jobs["browser-proof"], "Validate browser artifact selection and current runner"); guard.run = guard.run.replace('mkdir "$GITHUB_WORKSPACE/browser-binary-download"', 'true'); },
    w => { w.jobs["browser-shards"].steps.find(s => s.uses === download).with["artifact-ids"] = ""; },
    w => { w.jobs["browser-shards"].steps.find(s => s.uses === download).with["run-id"] = "old-run"; },
    w => { step(w.jobs["browser-shards"], "binary").env.BROWSER_BINARY_RECEIPT = "${{ inputs.receipt }}"; },
    w => { step(w.jobs["browser-shards"], "binary").run += " || true"; },
    w => { delete w.jobs["browser-shards"].env.CARGO_INCREMENTAL; },
    w => { w.jobs["browser-shards"].steps = w.jobs["browser-shards"].steps.filter(s => s.uses !== rust); },
    w => { delete w.jobs["browser-shards"].steps.find(s => s.uses?.startsWith("Swatinem/")).if; },
    w => { w.jobs["browser-shards"].steps.find(s => s.uses?.startsWith("Swatinem/")).with["save-if"] = "true"; },
    w => { named(w.jobs["browser-shards"], "Rebuild current-attempt source after a valid older producer").if = "always()"; },
    w => { named(w.jobs["browser-shards"], "Rebuild current-attempt source after a valid older producer").run = "true"; },
    w => { w.jobs["browser-proof"].steps.find(s => s.run?.includes("run test:e2e")).env.NAC_E2E_BINARY = "/old/binary"; },
    w => { named(w.jobs["browser-proof"], "Stage only the two bounded ALL471 goal receipts").run = "python3 .github/scripts/browser-proof.py"; },
    w => { const artifact = named(w.jobs["browser-proof"], "Retain only ALL471 goal proof and cleanup receipts"); artifact.with.name = artifact.with.name.replace("-${{ github.run_id }}", ""); },
    w => { const artifact = named(w.jobs["browser-proof"], "Retain only ALL471 goal proof and cleanup receipts"); artifact.with.name = artifact.with.name.replace("-${{ github.run_attempt }}", ""); },
    w => { named(w.jobs["browser-proof"], "Retain only ALL471 goal proof and cleanup receipts").with.overwrite = true; },
    w => { w.jobs.browser.needs = ["prepare", "browser-shards", "browser-proof"]; },
    w => { w.jobs["required-pr-checks"].needs = w.jobs["required-pr-checks"].needs.filter(n => n !== "browser-binary"); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const broken = structuredClone(stable);
    mutate(broken);
    assert.throws(() => validate(broken), undefined, `seed ${index}`);
  }
  assert.throws(() => validate(stable, requiredJobs.filter(n => n !== "browser-binary")));
});

test("two proof attempts retain unique artifacts while the retained producer requires fresh source", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-browser-proof-retry-"));
  try {
    const source = "a".repeat(40);
    const run = "123456";
    const fixture = path.join(root, "fixture");
    fs.writeFileSync(fixture, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const common = ["--source", source, "--repository", "arcee-ai/nac", "--run-id", run,
      "--target", "x86_64-unknown-linux-gnu", "--rustc", "rustc 1.98.0 (88d9e12ae 2026-08-18)",
      "--runner-image", "ubuntu26@20261101.186.1"];
    const cli = (command, args, attempt, receipt) => JSON.parse(execFileSync("python3",
      [".github/scripts/browser-binary.py", command, ...args, ...common, "--attempt", String(attempt)],
      { encoding: "utf8", env: { ...process.env, BROWSER_BINARY_RECEIPT: JSON.stringify(receipt ?? {}) } }));
    const producer = cli("pack", ["--binary", fixture, "--output-dir", path.join(root, "producer")], 1);
    const retainedBytes = fs.readFileSync(producer.archive);
    const template = named(stable.jobs["browser-proof"], "Retain only ALL471 goal proof and cleanup receipts").with.name;
    const name = (attempt, runId = run) => template.replace("${{ needs.prepare.outputs.sha }}", source)
      .replace("${{ github.run_id }}", runId).replace("${{ github.run_attempt }}", String(attempt));
    const records = [];
    for (const attempt of [1, 2]) {
      const output = path.join(root, `runtime-${attempt}`);
      const admitted = cli("consume", ["--archive", producer.archive, "--output-dir", output], attempt, producer.receipt);
      const artifactName = name(attempt);
      assert.match(artifactName, /^all471-goal-proof-[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/);
      assert.ok(artifactName.length < 128);
      records.push({ attempt, artifactName, admitted });
      assert.equal(admitted.producer_attempt, 1);
      assert.equal(admitted.mode, attempt === 1 ? "artifact" : "source");
      assert.equal(admitted.fallback_reason, attempt === 1 ? "" : "older-attempt");
      if (attempt === 2) {
        assert.equal(admitted.binary, "");
        assert.equal(admitted.binary_sha256, "");
        assert.equal(fs.existsSync(output), false);
      }
    }
    assert.notEqual(records[0].artifactName, records[1].artifactName);
    assert.notEqual(name(1), name(1, "123457"));
    assert.equal(producer.receipt.run_attempt, 1);
    assert.deepEqual(fs.readFileSync(producer.archive), retainedBytes);
    // A second upload namespace is current-attempt evidence, never permission
    // to execute the older producer's bytes or reuse its quality verdict.
    assert.ok(records[1].artifactName.endsWith(`-${run}-2`));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("actual runtime selection exposes only the verified artifact or the fresh source binary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-browser-select-"));
  try {
    const source = path.join(root, "target/debug/nac-web");
    const artifact = path.join(root, "verified/nac-web");
    for (const file of [source, artifact]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "fixture", { mode: 0o755 });
    }
    const run = step(stable.jobs["browser-shards"], "runtime").run;
    for (const [mode, verified, expected] of [["artifact", artifact, artifact], ["source", "", source],
      ["artifact", "", null], ["unknown", artifact, null]]) {
      const output = path.join(root, `output-${mode}-${verified ? "set" : "unset"}`);
      const result = spawnSync("bash", ["-e", "-c", run], { encoding: "utf8", env: {
        ...process.env, GITHUB_WORKSPACE: root, GITHUB_OUTPUT: output,
        BROWSER_BINARY_MODE: mode, VERIFIED_BROWSER_BINARY: verified,
      } });
      assert.equal(result.status === 0, expected !== null, result.stderr);
      if (expected) assert.equal(fs.readFileSync(output, "utf8"), `binary=${expected}\n`);
      else assert.equal(fs.existsSync(output), false);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("actual pre-download guard rejects empty image identity, wrong source/host and noncanonical artifact IDs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-browser-guard-"));
  try {
    fs.writeFileSync(path.join(root, "rustc"), '#!/bin/sh\nprintf "host: %s\\n" "$FAKE_RUST_HOST"\n', { mode: 0o755 });
    const guard = named(stable.jobs["browser-shards"], "Validate browser artifact selection and current runner").run;
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`,
      NAC_SOURCE_REVISION: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      ImageOS: "ubuntu24", ImageVersion: "20261101.1", BROWSER_ARTIFACT_ID: "123",
      FAKE_RUST_HOST: "x86_64-unknown-linux-gnu", GITHUB_WORKSPACE: root,
      BROWSER_BINARY_RECEIPT: "authenticated producer receipt" };
    const run = overrides => spawnSync("bash", ["-e", "-c", guard], { encoding: "utf8", env: { ...env, ...overrides } });
    const valid = run({});
    assert.equal(valid.status, 0);
    assert.equal(valid.stdout, "Browser consumer runner image: ubuntu24@20261101.1\n");
    for (const overrides of [
      { ImageOS: "" }, { ImageVersion: "" }, { NAC_SOURCE_REVISION: "b".repeat(40) },
      { BROWSER_BINARY_RECEIPT: "" },
      { FAKE_RUST_HOST: "aarch64-apple-darwin" },
      ...["", "0", "001", "1,2", "1;false"].map(value => ({ BROWSER_ARTIFACT_ID: value })),
    ]) assert.notEqual(run(overrides).status, 0, JSON.stringify(overrides));
    const destination = path.join(root, "browser-binary-download");
    assert.notEqual(run({}).status, 0, "existing directory must be preserved and rejected");
    fs.rmdirSync(destination);
    fs.writeFileSync(destination, "existing file");
    assert.notEqual(run({}).status, 0, "existing file must be preserved and rejected");
    assert.equal(fs.readFileSync(destination, "utf8"), "existing file");
    fs.unlinkSync(destination);
    const sibling = path.join(root, "sibling");
    fs.mkdirSync(sibling);
    fs.symlinkSync(sibling, destination);
    assert.notEqual(run({}).status, 0, "symlink destination must be preserved and rejected");
    assert.equal(fs.readlinkSync(destination), sibling);
    assert.deepEqual(fs.readdirSync(sibling), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CI browser transport and inventory output cannot dirty Git or Docker build context", () => {
  for (const directory of ["browser-binary-upload", "browser-binary-download", "browser-binary-runtime",
    "crates/nac-server/web/browser-inventory"]) {
    const git = spawnSync("git", ["check-ignore", "--no-index", `${directory}/fixture`], { encoding: "utf8" });
    assert.equal(git.status, 0, directory);
    assert.ok(fs.readFileSync(".dockerignore", "utf8").split("\n").includes(directory), directory);
  }
});
