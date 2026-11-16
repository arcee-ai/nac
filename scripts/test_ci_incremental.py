#!/usr/bin/env python3
"""Compiler-cache filesystem and CLI controls; never invokes real Cargo/Rust."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).with_name("ci-incremental.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ci_incremental", HELPER)
cache = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cache)
TARGET = "x86_64-unknown-linux-musl"
REPOSITORY = "arcee-ai/nac"
SHA = "a" * 40
FILE = "nac_core-abc/s-abc-def-ghi/dep-graph.bin"


class IncrementalCache(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nac-incremental-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        (self.workspace / "Cargo.toml").write_text('[workspace]\nmembers=["crates/nac-server"]\nresolver="2"\n')
        (self.workspace / "Cargo.lock").write_text('version=3\n[[package]]\nname="nac-server"\nversion="0.0.0"\n')
        member = self.workspace / "crates/nac-server"
        member.mkdir(parents=True)
        (member / "Cargo.toml").write_text('[package]\nname="nac-server"\nversion="0.0.0"\nedition="2021"\n')
        self.source = self.workspace / "target" / TARGET / "release/incremental"
        path = self.source / FILE
        path.parent.mkdir(parents=True)
        path.write_bytes(b"compiler work products only")
        (path.parent / "metadata.rmeta").write_bytes(b"metadata")
        (path.parent.parent / "s-abc-def.lock").write_bytes(b"")
        self.staging = self.workspace / ".nac-ci-incremental-cache" / TARGET
        self.event = self.root / "event.json"
        self.event.write_text(json.dumps({"repository": {"full_name": REPOSITORY}, "ref": "refs/heads/dev", "after": SHA}))
        self.environment = {"HOME": str(self.root / "home"), "CARGO_HOME": str(self.root / "home/.cargo"),
                            "CARGO_INCREMENTAL": "1", "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "16",
                            "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/dev",
                            "GITHUB_SHA": SHA, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_PATH": str(self.event)}
        self.environ = patch.dict(os.environ, self.environment, clear=True)
        self.environ.start()
        self.addCleanup(self.environ.stop)
        self.commands = patch.object(cache, "run", side_effect=self.fake_run)
        self.commands.start()
        self.addCleanup(self.commands.stop)

    def fake_run(self, _workspace, *args):
        if args == ("rustc", "-Vv"):
            return "rustc 1.98.0 (test)\nhost: x86_64-unknown-linux-gnu\nrelease: 1.98.0\ncommit-hash: test"
        if args == ("cargo", "-V"):
            return "cargo 1.98.0 (test)"
        if args == ("cargo", "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1"):
            return json.dumps({"workspace_root": str(self.workspace), "target_directory": str(self.workspace / "target"),
                               "packages": [{"manifest_path": str(self.workspace / "crates/nac-server/Cargo.toml")}]})
        if args == ("git", "rev-parse", "HEAD"):
            return SHA
        self.fail(f"unexpected tool invocation: {args}")

    def stage(self):
        return cache.stage(self.workspace, TARGET, REPOSITORY)

    def restore(self):
        return cache.restore(self.workspace, TARGET, REPOSITORY)

    def manifest(self):
        return json.loads((self.staging / "manifest.json").read_text())

    def edit_manifest(self, edit):
        value = self.manifest()
        edit(value)
        (self.staging / "manifest.json").write_text(json.dumps(value))

    def test_roundtrip_after_pinned_action_target_pruning(self):
        staged = self.stage()
        self.assertEqual(staged["files"], 3)
        original = {item["path"]: (self.source / item["path"]).read_bytes() for item in self.manifest()["files"]}
        # Pinned cleanProfileTarget keeps only build/.fingerprint/deps. In this
        # owned fixture, remove every other profile entry, including incremental.
        profile = self.source.parent
        (profile / "deps").mkdir()
        (profile / "deps/registry.rlib").write_bytes(b"external dependency")
        for path in profile.iterdir():
            if path.name not in {"build", ".fingerprint", "deps"}:
                shutil.rmtree(path) if path.is_dir() else path.unlink()
        self.assertFalse(self.source.exists())
        self.assertTrue(self.staging.exists(), "staging is outside the cleaned target")
        restored = self.restore()
        self.assertEqual(restored["status"], "restored")
        self.assertEqual(restored["seed_sha"], SHA)
        for name, content in original.items():
            self.assertEqual((self.source / name).read_bytes(), content)
        self.assertEqual((profile / "deps/registry.rlib").read_bytes(), b"external dependency")

    def test_absent_cache_is_cold_but_missing_manifest_is_corrupt(self):
        self.assertEqual(self.restore(), {"status": "cold", "reason": "absent-cache"})
        self.assertFalse(self.staging.exists())
        self.staging.mkdir(parents=True)
        with self.assertRaises(ValueError):
            self.restore()

    def test_corrupt_bytes_missing_extra_and_duplicate_records_fail(self):
        self.stage()
        payload = self.staging / "data" / FILE
        original = payload.read_bytes()
        shutil.rmtree(self.source)
        payload.write_bytes(b"x" * len(original))
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.restore()
        payload.write_bytes(original)
        saved = (self.staging / "manifest.json").read_bytes()
        for edit in [lambda value: value["files"].pop(), lambda value: value["files"].append(value["files"][0]),
                     lambda value: value.update(total_bytes=True), lambda value: value.update(extra=True),
                     lambda value: value["compatibility"].update(rustc=None),
                     lambda value: value["compatibility"]["flags"].update(TOKEN="plaintext"),
                     lambda value: value["files"][0].update(path="../outside")]:
            self.edit_manifest(edit)
            with self.assertRaises(ValueError):
                self.restore()
            (self.staging / "manifest.json").write_bytes(saved)
        (self.staging / "manifest.json").write_text('{"schema":"one","schema":"two"}')
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.restore()

    def test_foreign_repository_provenance_role_and_profile_fail(self):
        self.stage()
        saved = (self.staging / "manifest.json").read_bytes()
        for section, key, value in [("compatibility", "repository", "foreign/nac"), ("compatibility", "profile", "dev"),
                                    ("compatibility", "role", "test"), ("provenance", "event", "pull_request"),
                                    ("provenance", "ref", "refs/tags/v1"), ("provenance", "candidate_sha", "bad"),
                                    ("provenance", "run_attempt", 1)]:
            self.edit_manifest(lambda data: data[section].update({key: value}))
            with self.assertRaises(ValueError):
                self.restore()
            (self.staging / "manifest.json").write_bytes(saved)

    def test_legitimate_compatibility_changes_are_cold_without_target_mutation(self):
        self.stage()
        original = (self.source / FILE).read_bytes()
        for extra in [{"RUSTFLAGS": "--cfg changed"}, {"CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER": "other-linker"}]:
            with patch.dict(os.environ, extra):
                self.assertEqual(self.restore()["reason"], "configuration-mismatch")
        (self.workspace / "Cargo.lock").write_text((self.workspace / "Cargo.lock").read_text() + "# changed lock input\n")
        self.assertEqual(self.restore()["reason"], "configuration-mismatch")
        self.assertEqual((self.source / FILE).read_bytes(), original)

    def test_sensitive_inputs_are_hashed_and_identity_changes_do_not_invalidate_context(self):
        config = self.workspace / ".cargo/config.toml"
        config.parent.mkdir()
        config.write_text('[registries.example]\ntoken="sensitive-config-value"\n')
        with patch.dict(os.environ, {"CARGO_REGISTRIES_EXAMPLE_TOKEN": "sensitive-env-value", "NAC_SOURCE_REVISION": SHA}):
            self.stage()
            encoded = (self.staging / "manifest.json").read_text()
            self.assertNotIn("sensitive-config-value", encoded)
            self.assertNotIn("sensitive-env-value", encoded)
            expected = cache.compatibility(self.workspace, TARGET, REPOSITORY)
            with patch.dict(os.environ, {"NAC_SOURCE_REVISION": "b" * 40, "NAC_BUILD_ID": "dev-next"}):
                self.assertEqual(cache.compatibility(self.workspace, TARGET, REPOSITORY), expected)

    def test_symlinks_special_files_hardlinked_cache_and_unexpected_content_rejected(self):
        target = self.root / "secret"
        target.write_bytes(b"do not copy")
        original = self.source / FILE
        original.unlink()
        original.symlink_to(target)
        with self.assertRaises((ValueError, OSError)):
            self.stage()
        original.unlink()
        os.mkfifo(original)
        with self.assertRaises(ValueError):
            self.stage()
        original.unlink()
        original.write_bytes(b"compiler")
        (original.parent / "credentials.toml").write_bytes(b"secret")
        with self.assertRaises(ValueError):
            self.stage()
        (original.parent / "credentials.toml").unlink()
        self.stage()
        payload = self.staging / "data" / FILE
        os.link(payload, self.root / "hardlink")
        with self.assertRaises(ValueError):
            self.restore()
        (self.root / "hardlink").unlink()
        payload.unlink()
        payload.symlink_to(original)
        with self.assertRaises((ValueError, OSError)):
            self.restore()

    def test_path_ancestor_links_and_existing_output_are_protected(self):
        self.stage()
        with self.assertRaisesRegex(ValueError, "existing compiler output"):
            self.restore()
        with self.assertRaises(ValueError):
            cache.canonical(self.workspace / ".." / "other")
        alias = self.root / "alias"
        alias.symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaises(ValueError):
            cache.canonical(alias / "target")
        shutil.rmtree(self.source)
        self.source.parent.rename(self.source.parent.with_name("release-original"))
        self.source.parent.symlink_to(self.source.parent.with_name("release-original"), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.restore()

    def test_size_count_and_directory_bounds_reject_before_copy(self):
        with patch.object(cache, "MAX_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "bounds"):
                self.stage()
        with patch.object(cache, "MAX_FILE", 1):
            with self.assertRaisesRegex(ValueError, "byte bound"):
                self.stage()
        with patch.object(cache, "MAX_FILES", 1):
            with self.assertRaisesRegex(ValueError, "bounds"):
                self.stage()
        with patch.object(cache, "MAX_ENTRIES", 1):
            with self.assertRaisesRegex(ValueError, "inventory"):
                self.stage()
        self.assertFalse(self.staging.exists())

    def test_copy_failure_is_atomic_and_low_disk_never_changes_destination(self):
        self.stage()
        saved = (self.staging / "manifest.json").read_bytes()
        original = cache.transfer
        copies = 0
        def partial(*args, **kwargs):
            nonlocal copies
            if len(args) > 2 and args[2] is not None:
                copies += 1
                if copies == 2:
                    raise OSError("copy failure")
            return original(*args, **kwargs)
        with patch.object(cache, "transfer", side_effect=partial):
            with self.assertRaises(OSError):
                self.stage()
        self.assertEqual((self.staging / "manifest.json").read_bytes(), saved)
        self.assertFalse(list(self.staging.parent.glob(".incremental-stage-*")))
        shutil.rmtree(self.source)
        with patch.object(cache.shutil, "disk_usage", return_value=type("Usage", (), {"free": 0})()):
            with self.assertRaisesRegex(ValueError, "insufficient room"):
                self.restore()
        self.assertFalse(self.source.exists())
        copies = 0
        with patch.object(cache, "transfer", side_effect=partial):
            with self.assertRaises(OSError):
                self.restore()
        self.assertFalse(self.source.exists())
        self.assertFalse(list(self.source.parent.glob(".incremental-restore-*")))

    def test_stage_publication_failure_restores_the_previous_snapshot(self):
        self.stage()
        previous = (self.staging / "manifest.json").read_bytes()
        (self.source / FILE).write_bytes(b"updated compiler work products")
        replace = os.replace
        def fail_publication(source, destination):
            if Path(source).name.startswith(".incremental-stage-") and Path(destination) == self.staging:
                raise OSError("publication failure")
            return replace(source, destination)
        with patch.object(cache.os, "replace", side_effect=fail_publication):
            with self.assertRaises(OSError):
                self.stage()
        self.assertEqual((self.staging / "manifest.json").read_bytes(), previous)
        self.assertFalse(list(self.staging.parent.glob(".incremental-stage-*")))
        self.stage()
        self.assertEqual((self.staging / "data" / FILE).read_bytes(), b"updated compiler work products")

    def test_all_nontrusted_events_and_wrong_push_bindings_cannot_stage(self):
        for update in [{"GITHUB_EVENT_NAME": "pull_request"}, {"GITHUB_EVENT_NAME": "workflow_dispatch"},
                       {"GITHUB_REF": "refs/tags/v1"}, {"GITHUB_REF": "refs/heads/feature"},
                       {"GITHUB_REPOSITORY": "foreign/nac"}, {"GITHUB_SHA": "b" * 40},
                       {"GITHUB_RUN_ATTEMPT": "0"}]:
            with patch.dict(os.environ, update):
                with self.assertRaises(ValueError):
                    self.stage()
            self.assertFalse(self.staging.exists())
        self.event.write_text(json.dumps({"repository": {"full_name": REPOSITORY}, "ref": "refs/heads/dev", "after": "b" * 40}))
        with self.assertRaises(ValueError):
            self.stage()

    def test_profile_and_incremental_cannot_silently_change(self):
        for update in [{"CARGO_INCREMENTAL": "0"}, {"CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "256"},
                       {"CARGO_PROFILE_RELEASE_OPT_LEVEL": "2"}, {"CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS": "true"},
                       {"CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS": "true"}, {"RUSTC_WRAPPER": "/wrapper"}]:
            with patch.dict(os.environ, update):
                with self.assertRaises(ValueError):
                    self.restore()
        with self.assertRaises(ValueError):
            cache.compatibility(self.workspace, "x86_64-unknown-linux-gnu", REPOSITORY)
        (self.workspace / "Cargo.toml").write_text('[workspace]\nmembers=[]\n[profile.release]\ndebug-assertions=true\n')
        with self.assertRaises(ValueError):
            self.restore()

    def test_wrong_toolchain_cannot_seed_or_restore(self):
        original = self.fake_run
        def changed(workspace, *args):
            return "rustc 1.99.0\nrelease: 1.99.0" if args == ("rustc", "-Vv") else original(workspace, *args)
        with patch.object(cache, "run", side_effect=changed):
            with self.assertRaisesRegex(ValueError, "pinned Rust"):
                self.restore()
            with self.assertRaisesRegex(ValueError, "pinned Rust"):
                self.stage()
        self.assertFalse(self.staging.exists())

    def test_manifest_fifo_root_links_and_corruption_on_mismatch_fail_closed(self):
        self.stage()
        manifest = self.staging / "manifest.json"
        original = manifest.read_bytes()
        manifest.unlink()
        os.mkfifo(manifest)
        with self.assertRaises(ValueError):
            self.restore()
        manifest.unlink()
        manifest.write_bytes(original)
        (self.staging / "data" / FILE).write_bytes(b"x" * len((self.staging / "data" / FILE).read_bytes()))
        with patch.dict(os.environ, {"RUSTFLAGS": "--cfg other"}):
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.restore()
        self.staging.rename(self.staging.with_name(TARGET + "-original"))
        self.staging.symlink_to(self.staging.with_name(TARGET + "-original"), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.restore()

    def test_restage_replaces_only_verified_owned_staging(self):
        self.stage()
        (self.source / FILE).write_bytes(b"next work products")
        self.stage()
        self.assertEqual((self.staging / "data" / FILE).read_bytes(), b"next work products")
        self.assertEqual(set(path.name for path in self.staging.iterdir()), {"data", "manifest.json"})
        (self.staging / "unexpected").write_bytes(b"unowned")
        with self.assertRaises(ValueError):
            self.stage()
        self.assertEqual((self.staging / "unexpected").read_bytes(), b"unowned")

    def test_real_cli_with_fake_tools_has_cold_stage_restore_and_writer_failure(self):
        # These tools only print fixture metadata; no real Cargo/compiler runs,
        # lockfile generation, downloads or large fixture copies occur.
        tools = self.root / "tools"
        tools.mkdir()
        answers = {"cargo": {"-V": "cargo 1.98.0 (fixture)", "metadata": self.fake_run(self.workspace, "cargo", "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1")},
                   "rustc": {"-Vv": self.fake_run(self.workspace, "rustc", "-Vv")}, "git": {"rev-parse": SHA}}
        for tool, values in answers.items():
            script = tools / tool
            script.write_text(f"#!{sys.executable}\nimport sys\nanswers={values!r}\nprint(answers[sys.argv[1]])\n")
            script.chmod(0o755)
        environment = {**self.environment, "PATH": str(tools)}
        def cli(command, extra=None):
            return subprocess.run([sys.executable, str(HELPER), command, "--workspace", str(self.workspace), "--target", TARGET], env={**environment, **(extra or {})}, text=True, capture_output=True)
        self.assertEqual(json.loads(cli("restore").stdout)["status"], "cold")
        denied = cli("stage", {"GITHUB_EVENT_NAME": "pull_request"})
        self.assertNotEqual(denied.returncode, 0)
        self.assertFalse(self.staging.exists())
        staged = cli("stage")
        self.assertEqual(staged.returncode, 0, staged.stderr)
        shutil.rmtree(self.source)
        restored = cli("restore", {"GITHUB_EVENT_NAME": "pull_request"})
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(json.loads(restored.stdout)["status"], "restored")


if __name__ == "__main__":
    unittest.main()
