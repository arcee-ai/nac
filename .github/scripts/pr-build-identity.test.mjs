import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";

// Exercise Cargo's actual fingerprint decisions, rather than only inspecting
// build-script output. The probe has no dependencies and never builds NAC.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-build-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync("scripts/build-identity.rs", path.join(root, "scripts/build-identity.rs"));
  const crate = path.join(root, "crates/probe");
  fs.mkdirSync(path.join(crate, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "version.txt"), "0.1.5\n");
  fs.writeFileSync(path.join(crate, "Cargo.toml"), '[package]\nname = "nac-identity-probe"\nversion = "0.0.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(crate, "Cargo.lock"), 'version = 3\n[[package]]\nname = "nac-identity-probe"\nversion = "0.0.0"\n');
  fs.writeFileSync(path.join(crate, "build.rs"), '#[path = "../../scripts/build-identity.rs"]\nmod identity;\nfn main() { identity::configure(); }\n');
  fs.writeFileSync(path.join(crate, "src/main.rs"), 'fn main() { println!("{}|{}|{}|{}", env!("NAC_PRODUCT_VERSION"), env!("NAC_BUILD_TRACK"), env!("NAC_SOURCE_REVISION"), env!("NAC_BUILD_ID")); }\n');
  const env = { ...process.env };
  for (const key of ["NAC_BUILD_TRACK", "NAC_SOURCE_REVISION", "NAC_BUILD_ID", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "CARGO_TARGET_DIR"]) delete env[key];
  function run(command, args, cwd = root, extra = {}) {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...env, ...extra }, timeout: 60_000 });
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result;
  }
  const git = (...args) => run("git", args).stdout.trim();
  git("init", "--initial-branch=probe");
  git("config", "user.email", "identity-test@example.invalid");
  git("config", "user.name", "Identity Test");
  git("add", ".");
  git("commit", "-m", "probe");
  const build = (cwd = crate, extra = {}) => stripVTControlCharacters(run(process.env.CARGO || "cargo", ["build", "--locked", "--offline", "-vv"], cwd, extra).stderr);
  const identity = (cwd = crate) => run(path.join(cwd, "target/debug/nac-identity-probe"), []).stdout.trim().split("|");
  return { root, crate, git, run, build, identity };
}

function fresh(probe, cwd, extra) {
  assert.match(probe.build(cwd, extra), /Fresh nac-identity-probe/, "unchanged identity must reuse the compiled probe");
}

test("detached HEAD stays fresh without packed-refs and tracks revision changes", t => {
  const p = fixture(t);
  const first = p.git("rev-parse", "HEAD");
  p.git("checkout", "--detach");
  p.build();
  assert.equal(p.identity()[2], first);
  fresh(p);
  p.git("branch", "irrelevant");
  p.git("pack-refs", "--all", "--prune");
  fresh(p);
  p.git("commit", "--allow-empty", "-m", "next");
  p.build();
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  fresh(p);
});

test("nested symbolic refs and unborn HEAD gain fresh identities after ref creation", t => {
  const p = fixture(t);
  const original = p.git("rev-parse", "HEAD");
  p.git("symbolic-ref", "refs/heads/alias", "refs/heads/probe");
  p.git("symbolic-ref", "HEAD", "refs/heads/alias");
  p.build();
  fresh(p);
  p.git("commit", "--allow-empty", "-m", "through alias");
  p.build();
  assert.notEqual(p.identity()[2], original);
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  fresh(p);
  p.git("symbolic-ref", "HEAD", "refs/heads/new/nested/unborn");
  p.build();
  assert.equal(p.identity()[2], "unknown");
  fresh(p);
  p.git("update-ref", "refs/heads/new/nested/unborn", original);
  p.build();
  assert.equal(p.identity()[2], original);
  fresh(p);
});

test("symbolic HEAD tracks loose, packed and recreated loose refs", t => {
  const p = fixture(t);
  p.build();
  fresh(p);
  p.git("commit", "--allow-empty", "-m", "loose");
  p.build();
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  p.git("pack-refs", "--all", "--prune");
  p.build();
  fresh(p);
  p.git("commit", "--allow-empty", "-m", "unpacked");
  p.build();
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  fresh(p);
});

test("worktree HEAD and shared packed refs retain exact per-worktree identity", t => {
  const p = fixture(t);
  const worktree = path.join(p.root, "linked");
  p.git("worktree", "add", "-b", "linked", worktree);
  const crate = path.join(worktree, "crates/probe");
  p.build(crate);
  fresh(p, crate);
  p.git("pack-refs", "--all", "--prune");
  p.build(crate);
  fresh(p, crate);
  p.run("git", ["commit", "--allow-empty", "-m", "linked update"], worktree);
  p.build(crate);
  const revision = p.run("git", ["rev-parse", "HEAD"], worktree).stdout.trim();
  assert.equal(p.identity(crate)[2], revision);
  assert.notEqual(revision, p.git("rev-parse", "HEAD"));
  fresh(p, crate);
});

test("explicit build identity is stable across Git changes and refreshes on env changes", t => {
  const p = fixture(t);
  const env = { NAC_BUILD_TRACK: "stable", NAC_SOURCE_REVISION: "a".repeat(40), NAC_BUILD_ID: "v0.1.5" };
  p.build(undefined, env);
  assert.deepEqual(p.identity(), ["0.1.5", "stable", env.NAC_SOURCE_REVISION, "v0.1.5"]);
  fresh(p, undefined, env);
  p.git("commit", "--allow-empty", "-m", "irrelevant to explicit revision");
  fresh(p, undefined, env);
  p.build(undefined, { ...env, NAC_SOURCE_REVISION: "b".repeat(40), NAC_BUILD_ID: "other" });
  assert.deepEqual(p.identity(), ["0.1.5", "stable", "b".repeat(40), "other"]);
  p.build();
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  p.build(undefined, { NAC_SOURCE_REVISION: "   " });
  assert.equal(p.identity()[2], p.git("rev-parse", "HEAD"));
  p.build(undefined, { NAC_BUILD_TRACK: "beta", NAC_BUILD_ID: "beta-build" });
  assert.deepEqual(p.identity().slice(1), ["beta", p.git("rev-parse", "HEAD"), "beta-build"]);
  fs.writeFileSync(path.join(p.root, "version.txt"), "0.1.6\n");
  p.build();
  assert.equal(p.identity()[0], "0.1.6");
});
