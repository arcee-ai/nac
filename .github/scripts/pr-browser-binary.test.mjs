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
const step = (job, id) => job.steps.find(s => s.id === id);
const named = (job, name) => job.steps.find(s => s.name === name);

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
    assert.match(guard.run, /\$\{ImageOS:\?missing runner OS\}.*\$\{ImageVersion:\?missing runner image version\}/);
    assert.ok(guard.run.includes('[[ "$BROWSER_ARTIFACT_ID" =~ ^[1-9][0-9]*$ ]]'));
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
    assert.equal(cache.with["save-if"], trustedWrite);
    assert.equal(cache.with["prefix-key"], "nac-ci-v1");
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
  assert.deepEqual(config.jobs.browser.needs, ["prepare", "browser-binary", "browser-shards", "browser-proof"]);
  assert.equal(config.jobs.browser.steps[0].env.BINARY_RESULT, "${{ needs.browser-binary.result }}");
  assert.match(config.jobs.browser.steps[0].run, /test "\$BINARY_RESULT" = success/);
  assert.ok(required.includes("browser-binary"));
  assert.ok(config.jobs["required-pr-checks"].needs.includes("browser-binary"));
  for (const job of [producer, config.jobs["browser-shards"], proof]) {
    for (const cache of job.steps.filter(s => s.uses?.startsWith("Swatinem/rust-cache@"))) {
      assert.equal(cache.with["save-if"], trustedWrite);
    }
  }
}

test("parsed same-run browser producer and consumers preserve identity, runtime and retry contracts", () => validate(stable));

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
      FAKE_RUST_HOST: "x86_64-unknown-linux-gnu" };
    const run = overrides => spawnSync("bash", ["-e", "-c", guard], { encoding: "utf8", env: { ...env, ...overrides } });
    assert.equal(run({}).status, 0);
    for (const overrides of [
      { ImageOS: "" }, { ImageVersion: "" }, { NAC_SOURCE_REVISION: "b".repeat(40) },
      { FAKE_RUST_HOST: "aarch64-apple-darwin" },
      ...["", "0", "001", "1,2", "1;false"].map(value => ({ BROWSER_ARTIFACT_ID: value })),
    ]) assert.notEqual(run(overrides).status, 0, JSON.stringify(overrides));
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
