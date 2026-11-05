import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const workflow = () => YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));
const trust = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
const staging = "github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') && steps.release-cache.outputs.cache-hit != 'true'";
const normalize = value => value?.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
const command = operation => `python3 scripts/ci-incremental.py ${operation} --workspace "$(pwd -P)" --target "$RELEASE_TARGET"`;
const compilerEnv = { CARGO_INCREMENTAL: "1", RELEASE_TARGET: "${{ matrix.target }}" };
const step = (value, name) => value.jobs.build.steps.find(item => item.name === name);
const ignores = () => [fs.readFileSync(".gitignore", "utf8"), fs.readFileSync(".dockerignore", "utf8")];

function verify(actual, gitignore, dockerignore) {
  const job = actual.jobs.build;
  assert.equal(job.needs, "prepare");
  assert.equal(job.if, "${{ needs.prepare.outputs.run == 'true' }}");
  assert.equal(job["runs-on"], "${{ matrix.runner }}");
  assert.equal(job.strategy["fail-fast"], false);
  assert.deepEqual(job.strategy.matrix.include, [
    { runner: "ubuntu-latest", target: "x86_64-unknown-linux-musl" },
    { runner: "macos-26", target: "aarch64-apple-darwin" },
  ]);
  assert.deepEqual(job.env, { CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16" });
  assert.equal(job.permissions, undefined);
  assert.equal(job.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  const pinned = step(actual, "Install Rust");
  assert.equal(pinned.uses, "dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0");
  assert.equal(pinned.with.targets, "${{ matrix.target }}");
  const names = ["Cache Rust build", "Restore verified compiler incremental data", "Build nac-web binary", "Package and verify archive", "Stage trusted compiler incremental snapshot", "Upload archive"];
  const positions = names.map(name => job.steps.findIndex(item => item.name === name));
  assert.ok(positions.every((index, i) => index >= 0 && (i === 0 || index > positions[i - 1])), "restore, mandatory build, archive verification and trusted staging stay ordered");
  const cache = step(actual, names[0]);
  assert.equal(cache.id, "release-cache");
  assert.equal(cache.uses, "Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4");
  assert.equal(cache.with["prefix-key"], "nac-ci-v1");
  assert.equal(cache.with.key, "${{ github.job }}-${{ matrix.target }}-incremental16-v1");
  assert.equal(cache.with["cache-directories"], "${{ github.workspace }}/.nac-ci-incremental-cache/${{ matrix.target }}");
  assert.equal(cache.with["save-if"], trust);
  assert.equal(cache.with["cache-workspace-crates"], undefined);
  assert.equal(cache.with["cache-on-failure"], undefined);
  assert.equal(cache.if, undefined);
  const restore = step(actual, names[1]);
  assert.equal(restore.run, command("restore"));
  assert.deepEqual(restore.env, compilerEnv);
  assert.equal(restore.if, undefined, "absence must reach the helper's cold path");
  const build = step(actual, names[2]);
  assert.equal(normalize(build.run), "cargo build --release --locked -p nac-server --bin nac-web --target ${{ matrix.target }}");
  assert.equal(build.if, undefined, "a cache hit cannot replace the exact-candidate Cargo build");
  assert.deepEqual(build.env, {
    CARGO_INCREMENTAL: "1",
    NAC_BUILD_TRACK: "${{ (github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) && 'stable' || 'dev' }}",
    NAC_BUILD_ID: "${{ needs.prepare.outputs.tag || format('dev-{0}', needs.prepare.outputs.sha) }}",
    NAC_SOURCE_REVISION: "${{ needs.prepare.outputs.sha }}",
  });
  const archive = step(actual, names[3]);
  assert.equal(archive.if, undefined);
  assert.deepEqual(archive.env, { RELEASE_VERSION: "${{ needs.prepare.outputs.version }}", SOURCE_SHA: "${{ needs.prepare.outputs.sha }}" });
  for (const check of ['short_revision="$(git rev-parse --short=12 "$SOURCE_SHA")"', 'test "$(dist/pkg/nac-web -V)" = "nac-web $RELEASE_VERSION"', 'test "$(dist/pkg/nac-web --version)" = "nac-web $RELEASE_VERSION ($short_revision)"', 'test "$(tar -tzf "dist/nac-${{ matrix.target }}.tar.gz" | sort)" = "$(printf \'LICENSE\\nnac-web\')"']) {
    assert.ok(archive.run.includes(check), `missing archive execution/content check: ${check}`);
  }
  const stage = step(actual, names[4]);
  assert.equal(normalize(stage.if), staging);
  assert.deepEqual(stage.env, compilerEnv);
  assert.equal(stage.run, command("stage"));
  const upload = step(actual, names[5]);
  assert.equal(upload.if, undefined);
  assert.equal(upload.uses, "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
  assert.deepEqual(upload.with, { name: "nac-${{ matrix.target }}", path: "dist/nac-${{ matrix.target }}.tar.gz" });
  for (const item of job.steps) assert.equal(item["continue-on-error"], undefined);
  assert.ok(actual.jobs["required-pr-checks"].needs.includes("build"));
  assert.ok(actual.jobs.publish.needs.includes("build"));
  assert.ok(actual.jobs.publish.needs.includes("required-pr-checks"));
  for (const [name, other] of Object.entries(actual.jobs)) {
    if (name === "build") continue;
    assert.ok(!(other.steps ?? []).some(item => item.run?.includes("ci-incremental.py") || item.with?.["cache-directories"]?.includes(".nac-ci-incremental-cache")), `unexpected release cache use in ${name}`);
  }
  for (const text of [gitignore, dockerignore]) {
    assert.ok(text.split("\n").includes("/.nac-ci-incremental-cache/"), "reserved compiler staging root must leave both source and Docker contexts");
    assert.ok(!text.split("\n").some(line => line.startsWith("!") && line.includes(".nac-ci-incremental-cache")), "no staging-cache re-inclusion");
  }
}

test("release matrix restores bounded compiler data but always rebuilds and executes exact-candidate archives", () => {
  verify(workflow(), ...ignores());
  const result = spawnSync("git", ["check-ignore", "--no-index", ".nac-ci-incremental-cache/x86_64-unknown-linux-musl/manifest.json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("parsed release cache contract rejects trust, key, profile, cold-path, order and frozen-hit regressions", () => {
  const mutations = [
    value => { value.jobs.build.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "256"; },
    value => { step(value, "Cache Rust build").with["save-if"] = "true"; },
    value => { step(value, "Cache Rust build").with.key = "${{ github.job }}"; },
    value => { step(value, "Cache Rust build").with["cache-directories"] = "target/release/incremental"; },
    value => { step(value, "Cache Rust build").with["cache-workspace-crates"] = "true"; },
    value => { step(value, "Cache Rust build").with["cache-on-failure"] = "true"; },
    value => { step(value, "Restore verified compiler incremental data").env.CARGO_INCREMENTAL = "0"; },
    value => { step(value, "Restore verified compiler incremental data").if = "steps.release-cache.outputs.cache-hit == 'true'"; },
    value => { step(value, "Build nac-web binary").if = "steps.release-cache.outputs.cache-hit != 'true'"; },
    value => { step(value, "Build nac-web binary").env.NAC_SOURCE_REVISION = "old"; },
    value => { step(value, "Build nac-web binary").run += " --features managed-fault-fixture"; },
    value => { step(value, "Stage trusted compiler incremental snapshot").if = "github.event_name == 'push'"; },
    value => { step(value, "Stage trusted compiler incremental snapshot").if = staging.replace(" && steps.release-cache.outputs.cache-hit != 'true'", ""); },
    value => { step(value, "Stage trusted compiler incremental snapshot")["continue-on-error"] = true; },
    value => { step(value, "Package and verify archive").run = "echo unchecked"; },
    value => { const items = value.jobs.build.steps; const item = items.splice(items.findIndex(item => item.name === "Stage trusted compiler incremental snapshot"), 1)[0]; items.splice(items.findIndex(item => item.name === "Package and verify archive"), 0, item); },
    value => { const items = value.jobs.build.steps; const item = items.splice(items.findIndex(item => item.name === "Restore verified compiler incremental data"), 1)[0]; items.splice(items.findIndex(item => item.name === "Build nac-web binary") + 1, 0, item); },
    value => { value.jobs["required-pr-checks"].needs = value.jobs["required-pr-checks"].needs.filter(name => name !== "build"); },
  ];
  for (const mutate of mutations) {
    const candidate = workflow();
    mutate(candidate);
    assert.throws(() => verify(candidate, ...ignores()));
  }
  const [gitignore, dockerignore] = ignores();
  assert.throws(() => verify(workflow(), gitignore.replace("/.nac-ci-incremental-cache/", ""), dockerignore));
  assert.throws(() => verify(workflow(), gitignore, dockerignore + "\n!/.nac-ci-incremental-cache/secret\n"));
});
