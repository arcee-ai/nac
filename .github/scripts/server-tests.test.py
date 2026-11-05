#!/usr/bin/env python3
"""Stdlib installer/orchestration controls; optional real pinned-tool leak proof."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
import nextest_tool as tool

SPEC = importlib.util.spec_from_file_location("server_tests", Path(__file__).with_name("server-tests.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class Controls(unittest.TestCase):
    def test_pins_have_no_override(self):
        self.assertEqual(tool.VERSION, "0.9.151")
        self.assertEqual(tool.SHA256, "1d4ce302b820c41f4b89c5fb9bce45f0f0c94882c1cf08fc360caf08be6e7df4")
        self.assertEqual(tool.ARCHIVE_BYTES, 12161169)
        self.assertIn("cargo-nextest-0.9.151-x86_64-unknown-linux-gnu.tar.gz", tool.URL)
        with tempfile.TemporaryDirectory() as d:
            result = subprocess.run([sys.executable, tool.__file__, "--destination", str(Path(d) / "tool"),
                                     "--sha256", "a" * 64], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"unrecognized arguments", result.stderr)

    def test_download_failure_cleans_only_created_leaf(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(tool.urllib.request, "urlopen", side_effect=OSError("offline")):
            destination = Path(d) / "tool"
            with self.assertRaisesRegex(OSError, "offline"):
                tool.install(destination)
            self.assertFalse(destination.exists())

    def test_cli_corruption_fails_before_executable_runs_and_cleans(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "corrupt.tar.gz"
            marker = root / "EXECUTED"
            with tarfile.open(archive, "w:gz") as bundle:
                payload = f"#!/bin/sh\ntouch '{marker}'\n".encode()
                member = tarfile.TarInfo("cargo-nextest")
                member.size = len(payload)
                bundle.addfile(member, io.BytesIO(payload))
            result = subprocess.run([sys.executable, tool.__file__, "--archive", str(archive),
                                     "--destination", str(root / "tool")], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"wrong nextest archive size", result.stderr)
            self.assertFalse(marker.exists())
            self.assertFalse((root / "tool").exists())

    def test_same_size_corruption_requires_actual_pinned_hash(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d) / "wrong"
            with archive.open("wb") as f:
                f.truncate(tool.ARCHIVE_BYTES)
            with mock.patch.object(tool, "extract_binary") as extract:
                with self.assertRaisesRegex(ValueError, "SHA256"):
                    tool.install(Path(d) / "tool", archive)
                extract.assert_not_called()
            self.assertFalse((Path(d) / "tool").exists())

    def test_missing_symlink_and_oversized_archives_fail_without_exposure(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            regular = root / "regular"
            regular.write_bytes(b"x")
            (root / "link").symlink_to(regular)
            with (root / "large").open("wb") as f:
                f.truncate(tool.ARCHIVE_BYTES + 1)
            for name in ["missing", "link", "large"]:
                with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                    tool.install(root / "tool", root / name)
                self.assertFalse((root / "tool").exists())

    def test_existing_destination_is_never_deleted_or_reused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "existing").mkdir()
            (root / "existing/sentinel").write_text("keep")
            (root / "link").symlink_to(root / "existing")
            for name in ["existing", "link"]:
                with self.assertRaises(FileExistsError):
                    tool.install(root / name)
            self.assertEqual((root / "existing/sentinel").read_text(), "keep")

    def test_archive_members_are_fixed_unique_regular_and_bounded(self):
        cases = [("../cargo-nextest", tarfile.REGTYPE), ("/cargo-nextest", tarfile.REGTYPE),
                 ("cargo-nextest", tarfile.SYMTYPE), ("cargo-nextest", tarfile.LNKTYPE),
                 ("nested/cargo-nextest", tarfile.REGTYPE)]
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for i, (name, kind) in enumerate(cases):
                archive = root / str(i)
                with tarfile.open(archive, "w:gz") as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/bin/sh"
                    member.size = 1 if kind == tarfile.REGTYPE else 0
                    bundle.addfile(member, io.BytesIO(b"x") if member.size else None)
                with self.assertRaisesRegex(ValueError, "members"):
                    tool.extract_binary(archive, root / "output")
                self.assertFalse((root / "output").exists())
            archive = root / "duplicate"
            with tarfile.open(archive, "w:gz") as bundle:
                for _ in range(2):
                    member = tarfile.TarInfo("cargo-nextest")
                    member.size = 1
                    bundle.addfile(member, io.BytesIO(b"x"))
            with self.assertRaisesRegex(ValueError, "members"):
                tool.extract_binary(archive, root / "output")

    def test_bounded_transfer_and_wrong_version_fail(self):
        with self.assertRaisesRegex(ValueError, "bound"):
            tool.copy_bounded(io.BytesIO(b"xx"), io.BytesIO(), 1)
        valid = f"cargo-nextest 0.9.151 (x)\nrelease: 0.9.151\ncommit-hash: {tool.COMMIT}\nhost: x86_64-unknown-linux-gnu\n"
        for output in ["cargo-nextest 0.9.150\n", valid.replace(tool.COMMIT, "a" * 40),
                       valid.replace("host: x86_64-unknown-linux-gnu", "host: aarch64-apple-darwin")]:
            with mock.patch.object(tool.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output, "")):
                with self.assertRaisesRegex(ValueError, "version"):
                    tool.verify_version(Path("unused"))

    def test_policy_private_store_and_drift(self):
        with tempfile.TemporaryDirectory() as d:
            runtime = Path(d)
            config = runner.private_config(runtime)
            parsed = tomllib.loads(config.read_text())
            self.assertEqual(parsed.pop("store"), {"dir": str(runtime / "store")})
            self.assertEqual(parsed, runner.POLICY)
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            original = runner.PROFILE.read_text()
            for change in [original.replace('result = "fail"', 'result = "pass"'),
                           original.replace('"200ms"', '"500ms"'),
                           original.replace("retries = 0", "retries = 1"),
                           original + '\n[store]\ndir="target/nextest"\n',
                           original.replace("test-threads = 4", 'slow-timeout = "2s"'),
                           original + '\n[[profile.ci.overrides]]\nfilter="all()"\nretries=1\n']:
                candidate = runtime / "bad.toml"
                candidate.write_text(change)
                with self.assertRaises(ValueError):
                    runner.private_config(runtime, candidate)

    def test_runtime_rejects_every_compiler_or_workspace_root(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            workspace = root / "repo"
            for name in ["repo", "repo/target", "cargo-home", "custom-target", "private"]:
                (root / name).mkdir(parents=True, exist_ok=True)
            env = {"CARGO_HOME": str(root / "cargo-home"), "CARGO_TARGET_DIR": str(root / "custom-target")}
            for path in [workspace, workspace / "target", root / "cargo-home", root / "custom-target"]:
                with self.assertRaises(ValueError):
                    runner.temp_parent({**env, "RUNNER_TEMP": str(path)}, workspace)
            self.assertEqual(runner.temp_parent({**env, "RUNNER_TEMP": str(root / "private")}, workspace), (root / "private").resolve())
            with self.assertRaises(ValueError):
                runner.temp_parent({}, workspace)

    def test_full_commands_preserve_failure_and_run_doctests(self):
        invalid = subprocess.run([sys.executable, str(runner.ROOT / ".github/scripts/server-tests.py"), "--lib"], capture_output=True)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn(b"accepts no target selectors", invalid.stderr)
        for outcomes in [[0, 0, 0], [0, 100, 0], [0, 0, 1], [7]]:
            calls = []
            def run(command, _):
                calls.append(list(map(str, command)))
                return outcomes[len(calls) - 1]
            with contextlib.redirect_stdout(io.StringIO()):
                result = runner.suite("nextest", "private.toml", {}, run)
            self.assertEqual(result, next((n for n in outcomes if n), 0))
            self.assertEqual(calls[0], ["cargo", "test", "--locked", "-p", "nac-server", "--no-run"])
            if len(outcomes) > 1:
                self.assertEqual(calls[1], ["nextest", "nextest", "run", "--locked", "-p", "nac-server", "--config-file", "private.toml", "--profile", "ci", "--user-config-file", "none", "--test-threads", "4", "--retries", "0", "--no-fail-fast", "--run-ignored", "default"])
                self.assertEqual(calls[2], ["cargo", "test", "--locked", "-p", "nac-server", "--doc", "--no-fail-fast"])

    def test_private_state_cleaned_on_installer_and_suite_failure(self):
        with tempfile.TemporaryDirectory() as d:
            env = {"RUNNER_TEMP": d, "CARGO_HOME": str(Path(d).parent / "separate-cache"),
                   "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0", "CARGO_INCREMENTAL": "0"}
            for failure in ["install", "suite"]:
                with mock.patch.dict(os.environ, env, clear=True), \
                        mock.patch.object(runner, "install", side_effect=ValueError("install failure") if failure == "install" else None, return_value="tool"), \
                        mock.patch.object(runner, "suite", side_effect=ValueError("suite failure")), \
                        contextlib.redirect_stdout(io.StringIO()), self.assertRaises(ValueError):
                    runner.main()
                self.assertEqual(list(Path(d).iterdir()), [])


def native_control(binary, output):
    """Actual committed profile, real Rust tests; never enters NAC's inventory."""
    output.mkdir()
    owned = Path(tempfile.mkdtemp(prefix="nac-nextest-control-", dir="/tmp")).resolve()
    pid = None
    identity = None
    try:
        fixture = owned / "fixture"
        (fixture / "src").mkdir(parents=True)
        (fixture / "Cargo.toml").write_text('[package]\nname="nextest-policy-control"\nversion="0.0.0"\nedition="2021"\n[workspace]\n')
        source = '''#[cfg(test)] mod tests {
#[test] fn ordinary_pass() { assert_eq!(2+2,4); }
#[test] fn assertion_failure() { assert_eq!(2+2,5,"owned failure control"); }
#[test] fn successful_exit_leaks_output() {
use std::os::unix::process::CommandExt;
let child=std::process::Command::new("/bin/sleep").arg("30").process_group(0).spawn().unwrap();
std::fs::write(std::env::var_os("CONTROL_PID").unwrap(),child.id().to_string()).unwrap();
}}
'''
        (fixture / "src/lib.rs").write_text(source)
        (output / "fixture.rs").write_text(source)
        config = runner.private_config(owned)
        (output / "derived-config.toml").write_text(config.read_text())
        cargo = Path(os.environ.get("CARGO", shutil.which("cargo") or "missing")).absolute()
        rust = cargo.parent
        if not subprocess.check_output([cargo, "--version"], text=True).startswith("cargo 1.98.0 "):
            raise ValueError("native proof requires the explicitly pinned Rust1.98 toolchain")
        env = {"PATH": str(rust)+":/usr/bin:/bin:/usr/sbin:/sbin", "CARGO": str(cargo),
               "RUSTC": str(rust / "rustc"), "CARGO_HOME": os.environ.get("CARGO_HOME", str(Path.home() / ".cargo")),
               "CARGO_TARGET_DIR": str(owned / "target"), "CARGO_BUILD_JOBS": "6", "CARGO_INCREMENTAL": "0",
               "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0", "CARGO_NET_OFFLINE": "true",
               "RUSTUP_HOME": os.environ.get("RUSTUP_HOME", str(Path.home() / ".rustup")),
               "RUSTUP_TOOLCHAIN": "1.98.0",
               "HOME": str(owned / "home"), "CONTROL_PID": str(owned / "child.pid")}
        (owned / "home").mkdir()
        subprocess.run([str(cargo), "generate-lockfile", "--offline"], cwd=fixture, env=env, check=True, capture_output=True)
        command = [str(binary), "nextest", "run", "--locked", "--config-file", str(config), "--profile", "ci", "--user-config-file", "none", "--test-threads", "4", "--retries", "0", "--no-fail-fast"]
        with (output / "stdout").open("w") as stdout, (output / "stderr").open("w") as stderr:
            result = subprocess.run(command, cwd=fixture, env=env, stdout=stdout, stderr=stderr, timeout=20)
        pid = int((owned / "child.pid").read_text())
        assert os.getpgid(pid) == pid
        identity = subprocess.check_output(["ps", "-p", str(pid), "-o", "pid=,pgid=,lstart=,command="], text=True).strip()
        assert identity.endswith("/bin/sleep 30")
        junit = owned / "store/ci/junit.xml"
        root = ET.parse(junit).getroot()
        assert root.attrib["failures"] == "1" and root.attrib["errors"] == "1" and root.attrib["tests"] == "3"
        assert result.returncode == 100 and "LEAK-FAIL" in (output / "stderr").read_text()
        assert not (owned / "target/nextest").exists() and not (fixture / "target/nextest").exists()
        (output / "junit.xml").write_bytes(junit.read_bytes())
        (output / "receipt.json").write_text(json.dumps({"command": command, "exit": result.returncode, "child_identity": identity, "private_store": str(owned / "store"), "profile": runner.POLICY, "result": "one PASS, one FAIL, one LEAK-FAIL; zero retries; no state in compiler target"}, indent=2)+"\n")
    finally:
        if (owned / "child.pid").exists():
            pid = int((owned / "child.pid").read_text())
            assert pid > 1 and os.getpgid(pid) == pid
            identity_now = subprocess.check_output(["ps", "-p", str(pid), "-o", "pid=,pgid=,lstart=,command="], text=True).strip()
            assert identity_now.endswith("/bin/sleep 30") and (identity is None or identity_now == identity)
            os.killpg(pid, signal.SIGTERM)
            for _ in range(100):
                if subprocess.run(["ps", "-p", str(pid)], capture_output=True).returncode:
                    break
                time.sleep(.05)
            else:
                raise AssertionError("owned child survived cleanup")
        shutil.rmtree(owned)
        assert not owned.exists()
        (output / "cleanup.json").write_text(json.dumps({"private_runtime_removed": True,
                                                       "owned_child_removed": True}, indent=2)+"\n")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--native-tool":
        native_control(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve())
    else:
        unittest.main()
