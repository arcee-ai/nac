#!/usr/bin/env python3
"""Stdlib installer/orchestration controls; optional real pinned-tool leak proof."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
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
    def test_real_interrupt_escalates_only_owned_group_and_cleans_private_state(self):
        self.assertEqual(runner.SHUTDOWN_TERM_SECONDS, 15)
        self.assertEqual(runner.SHUTDOWN_KILL_SECONDS, 5)
        # Real signals/processes with a test-only shorter controller grace.
        # The production15s path was also exercised locally for both signals.
        control_grace = .15
        for signum in [signal.SIGINT, signal.SIGTERM]:
            with self.subTest(signal=signum), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                ready = root / "child.json"
                child = root / "ignore-term.py"
                child.write_text('import signal,time,os,sys,json\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(sys.argv[1],"w").write(json.dumps({"pid":os.getpid(),"pgid":os.getpgrp()}))\nwhile True:time.sleep(1)\n')
                driver = root / "controller.py"
                driver.write_text('import sys,signal,importlib.util,tempfile,pathlib,os\nsys.dont_write_bytecode=True\nsys.path.insert(0,' + repr(str(runner.ROOT / '.github/scripts')) + ')\ns=importlib.util.spec_from_file_location("runner",' + repr(str(runner.ROOT / '.github/scripts/server-tests.py')) + ')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.SHUTDOWN_TERM_SECONDS=0.15\nm.SHUTDOWN_KILL_SECONDS=1\nsignal.signal(signal.SIGTERM,m.interrupted)\nwith tempfile.TemporaryDirectory(prefix="private-",dir=sys.argv[1]) as runtime:\n pathlib.Path(sys.argv[1],"runtime").write_text(runtime)\n m.execute([sys.executable,sys.argv[2],sys.argv[3]],dict(os.environ))\n')
                unrelated = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(120)"], start_new_session=True)
                controller = subprocess.Popen([sys.executable, str(driver), str(root), str(child), str(ready)],
                                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
                identity = None
                settled = False
                try:
                    deadline = time.monotonic() + 5
                    while not ready.exists() and time.monotonic() < deadline:
                        time.sleep(.02)
                    self.assertTrue(ready.exists())
                    identity = json.loads(ready.read_text())
                    self.assertEqual(identity["pid"], identity["pgid"])
                    self.assertEqual(os.getpgid(identity["pid"]), identity["pgid"])
                    started = time.monotonic()
                    os.kill(controller.pid, signum)
                    stdout, stderr = controller.communicate(timeout=6)
                    elapsed = time.monotonic() - started
                    self.assertNotEqual(controller.returncode, 0)
                    self.assertIn(b"TERM grace expired; killing owned command group", stdout)
                    self.assertIn(b"KeyboardInterrupt", stderr)
                    self.assertGreaterEqual(elapsed, control_grace)
                    self.assertFalse(Path((root / "runtime").read_text()).exists())
                    with self.assertRaises(ProcessLookupError):
                        os.kill(identity["pid"], 0)
                    settled = True
                    self.assertIsNone(unrelated.poll(), "cancellation must not kill another group")
                finally:
                    if controller.poll() is None:
                        os.killpg(controller.pid, signal.SIGKILL)
                        controller.wait(timeout=5)
                    if identity is not None and not settled:
                        try:
                            command = subprocess.check_output(["ps", "-p", str(identity["pid"]), "-o", "command="], text=True)
                            if str(child) in command and os.getpgid(identity["pid"]) == identity["pgid"]:
                                os.killpg(identity["pgid"], signal.SIGKILL)
                        except (ProcessLookupError, subprocess.CalledProcessError):
                            pass
                    if unrelated.poll() is None:
                        os.killpg(unrelated.pid, signal.SIGKILL)
                    unrelated.wait(timeout=5)

    def test_pins_have_no_override(self):
        self.assertEqual(tool.VERSION, "0.9.151")
        self.assertEqual(tool.SHA256, "1d4ce302b820c41f4b89c5fb9bce45f0f0c94882c1cf08fc360caf08be6e7df4")
        self.assertEqual(tool.ARCHIVE_BYTES, 12161169)
        self.assertEqual(tool.ASSET_IDS, {"0.9.151": 703600788})
        self.assertEqual(tool.URL, "https://api.github.com/repos/nextest-rs/nextest/releases/assets/703600788")
        with tempfile.TemporaryDirectory() as d:
            result = subprocess.run([sys.executable, tool.__file__, "--destination", str(Path(d) / "tool"),
                                     "--sha256", "a" * 64], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"unrecognized arguments", result.stderr)

    def test_public_asset_download_still_verifies_bytes_before_extraction(self):
        payload = b"pinned archive response"
        import hashlib
        def transport(url, destination, bound):
            self.assertEqual(url, tool.URL)
            self.assertEqual(bound, len(payload))
            destination.write_bytes(payload)
        def extract(archive, destination):
            self.assertEqual(archive.read_bytes(), payload)
            destination.write_bytes(b"not executed")
        with tempfile.TemporaryDirectory() as d, mock.patch.object(
                tool, "ARCHIVE_BYTES", len(payload)), mock.patch.object(
                tool, "SHA256", hashlib.sha256(payload).hexdigest()), mock.patch.object(
                tool, "download_asset", side_effect=transport) as read, mock.patch.object(
                tool, "extract_binary", side_effect=extract), mock.patch.object(tool, "verify_version") as version:
            binary = tool.install(Path(d) / "tool")
            self.assertEqual(binary.read_bytes(), b"not executed")
            read.assert_called_once()
            version.assert_called_once()

    def test_api_error_or_corrupt_success_never_tries_another_route(self):
        for response in [OSError("HTTP403"), OSError("HTTP429"), OSError("HTTP504"), b"bad"]:
            def transport(url, destination, bound):
                if isinstance(response, Exception):
                    raise response
                destination.write_bytes(response)
            with self.subTest(response=response), tempfile.TemporaryDirectory() as d, mock.patch.object(
                    tool, "download_asset", side_effect=transport) as read, mock.patch.object(tool, "extract_binary") as extract:
                with self.assertRaises((OSError, ValueError)):
                    tool.install(Path(d) / "tool")
                self.assertEqual(read.call_count, 1)
                extract.assert_not_called()
                self.assertFalse((Path(d) / "tool").exists())

    def test_download_failure_cleans_only_created_leaf(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(tool, "download_asset", side_effect=OSError("offline")):
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
                           original.replace("test-threads = 4", "test-threads = 1"),
                           original.replace("max-threads = 1", "max-threads = 2"),
                           original.replace(runner.CONTROL_LISTENER_FILTER, "all()"),
                           original.replace(runner.OAUTH_LOOPBACK_FILTER, "all()"),
                           original.replace("loopback_retry_reuses_only_its_own_live_callback_listener|", ""),
                           original.replace('test-group = "oauth-loopback-port1456"', 'test-group = "@global"'),
                           original.replace("failed_listener_bind_keeps_accepted_candidate_in_maintenance|", ""),
                           original.replace(")$/)", "|unrelated_test)$/)"),
                           original.replace('test-group = "managed-control-port3211"', 'test-group = "@global"'),
                           original.split("[[profile.ci.overrides]]")[0],
                           original + '\n[[profile.ci.overrides]]\nfilter="all()"\nretries=1\n']:
                candidate = runtime / "bad.toml"
                candidate.write_text(change)
                with self.assertRaises(ValueError):
                    runner.private_config(runtime, candidate)

    def test_group_matches_only_source_owners_of_the_fixed_control_listener(self):
        source = (runner.ROOT / "crates/nac-server/src/managed_control_tests.rs").read_text()
        self.assertIn('managed_control_bind: Some("127.0.0.1:3211".to_string())', source)
        self.assertIn('SERVER_MODEL_ENV_LOCK.lock().unwrap()', source)
        functions = {part.split('(', 1)[0]: part for part in re.split(r'(?m)^(?:async )?fn ', source)[1:]}
        startup = {name for name, body in functions.items() if
                   'crate::serve_with_policy(' in body or
                   'crate::delivery::server::serve_with_policy_and_readiness(' in body}
        recovery = 'managed_v2_future_and_invalid_stores_serve_immutable_recovery_diagnostics'
        self.assertIn('assert!(recovery.is_recovery_only())', functions[recovery])
        self.assertEqual(startup - {recovery}, set(runner.CONTROL_LISTENER_TESTS))
        self.assertEqual(len(runner.CONTROL_LISTENER_TESTS), 3)
        self.assertEqual(runner.CONTROL_LISTENER_FILTER,
                         'package(=nac-server) & test(/^managed_control::tests::('
                         + '|'.join(runner.CONTROL_LISTENER_TESTS) + ')$/)')
        self.assertEqual(runner.POLICY['test-groups'], {'managed-control-port3211': {'max-threads': 1},
                                                        'oauth-loopback-port1456': {'max-threads': 1}})
        self.assertEqual(runner.POLICY['profile']['ci']['test-threads'], 4)
        self.assertEqual(runner.POLICY['profile']['ci']['overrides'],
                         [{'filter': runner.CONTROL_LISTENER_FILTER, 'test-group': 'managed-control-port3211'},
                          {'filter': runner.OAUTH_LOOPBACK_FILTER, 'test-group': 'oauth-loopback-port1456'}])
        fixed_config_files = {str(path.relative_to(runner.ROOT)) for path in
                              (runner.ROOT / 'crates/nac-server/src').rglob('*.rs')
                              if re.search(r'managed_control_bind:.*3211', path.read_text())}
        self.assertEqual(fixed_config_files, {'crates/nac-server/src/managed_control_tests.rs',
                                             'crates/nac-server/src/lib_tests.rs'})
        delivery = (runner.ROOT / 'crates/nac-server/src/tests/managed_delivery.rs').read_text()
        self.assertEqual(delivery.count('test_managed_bootstrap_control_manager_with_auth('), 1)
        delivery_functions = {part.split('(', 1)[0]: part for part in
                              re.split(r'(?m)^(?:async )?fn ', delivery)[1:]}
        control_consumer = delivery_functions['version_two_managed_repair_holds_upgrade_admission_until_completion']
        self.assertNotIn('serve_with_policy(', control_consumer)

    def test_loopback_group_matches_only_the_three_real_callback_port_owners(self):
        source = (runner.ROOT / 'crates/nac-server/src/tests/mcp_oauth/loopback.rs').read_text()
        functions = {part.split('(', 1)[0]: part for part in
                     re.split(r'(?m)^(?:async )?fn ', source)[1:]}
        owners = {name for name, body in functions.items()
                  if 'loopback_case(' in body.split('{', 1)[1]}
        self.assertEqual(owners, set(runner.OAUTH_LOOPBACK_TESTS))
        self.assertEqual(len(owners), 3)
        self.assertIn('127.0.0.1:1456', source)
        self.assertEqual(runner.OAUTH_LOOPBACK_FILTER,
                         'package(=nac-server) & test(/^tests::mcp_oauth::loopback::('
                         + '|'.join(runner.OAUTH_LOOPBACK_TESTS) + ')$/)')
        self.assertEqual(runner.POLICY['profile']['ci']['retries'], 0)
        self.assertEqual(runner.POLICY['profile']['ci']['test-threads'], 4)
        self.assertFalse(runner.POLICY['profile']['ci']['fail-fast'])

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


def listener_resource_control(binary, output):
    """Tiny real scheduler proof; no NAC dependency compilation or test substitution."""
    import hashlib
    output.mkdir(mode=0o700)
    # Official universal-apple-darwin 0.9.151 binary retained by the S12 trial.
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    if digest != "3237e5aac4329859cf9ff8bd4e07a53cffa6b30815f57059b3fa7411f9f2cf02":
        raise ValueError("resource proof requires the verified pinned Mac nextest")
    version = subprocess.check_output([binary, "--version", "--verbose"], text=True)
    (output / "nextest-version.txt").write_text(version)
    fixture = output / "fixture"
    (fixture / "src").mkdir(parents=True)
    (fixture / "Cargo.toml").write_text('[package]\nname="nac-server"\nversion="0.0.0"\nedition="2021"\n[workspace]\n')
    source = r'''use std::{fs, path::PathBuf, time::{Duration, Instant}};
fn root() -> PathBuf { std::env::var_os("RESOURCE_ROOT").unwrap().into() }
fn wait(path: &std::path::Path) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !path.exists() {
        assert!(Instant::now() < deadline, "bounded fixture barrier: {}", path.display());
        std::thread::sleep(Duration::from_millis(1));
    }
}
fn shared_listener(name: &str) {
    let root = root();
    let leader = fs::OpenOptions::new().write(true).create_new(true).open(root.join("leader")).is_ok();
    let listener = if leader {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        fs::write(root.join("address.pending"), listener.local_addr().unwrap().to_string()).unwrap();
        fs::rename(root.join("address.pending"), root.join("address")).unwrap();
        listener
    } else {
        wait(&root.join("address"));
        std::net::TcpListener::bind(fs::read_to_string(root.join("address")).unwrap())
            .expect("shared listener collision")
    };
    if leader {
        fs::write(root.join("active"), b"").unwrap();
        for name in ["unrelated_a", "unrelated_b", "unrelated_c"] { wait(&root.join(name)); }
        fs::write(root.join("four_concurrent"), b"").unwrap();
    }
    std::thread::sleep(Duration::from_millis(200));
    if leader { fs::write(root.join("release"), b"").unwrap(); }
    fs::write(root.join(format!("group-{name}")), std::env::var("NEXTEST_TEST_GROUP").unwrap()).unwrap();
    drop(listener);
}
fn unrelated(name: &str) {
    let root = root(); wait(&root.join("active"));
    fs::write(root.join(name), b"").unwrap(); wait(&root.join("release"));
    assert_eq!(std::env::var("NEXTEST_TEST_GROUP").unwrap(), "@global");
}
#[cfg(test)] mod managed_control { mod tests {
REPLACE_GROUPED_TESTS
}}
#[test] fn unrelated_a() { unrelated("unrelated_a"); }
#[test] fn unrelated_b() { unrelated("unrelated_b"); }
#[test] fn unrelated_c() { unrelated("unrelated_c"); }
'''.replace('REPLACE_GROUPED_TESTS', '\n'.join(
        f'#[test] fn {name}() {{ crate::shared_listener("{name}"); }}' for name in runner.CONTROL_LISTENER_TESTS))
    (fixture / "src/lib.rs").write_text(source)
    cargo = subprocess.check_output(["rustup", "which", "cargo", "--toolchain", "1.98.0"], text=True).strip()
    rustc = subprocess.check_output(["rustup", "which", "rustc", "--toolchain", "1.98.0"], text=True).strip()
    env = {**os.environ, "CARGO": cargo, "RUSTC": rustc, "RUSTUP_TOOLCHAIN": "1.98.0",
           "CARGO_TARGET_DIR": str(output / "target"), "CARGO_NET_OFFLINE": "true", "CARGO_BUILD_JOBS": "6",
           "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0"}
    if shutil.disk_usage(output).free < 12 * 1024**3:
        raise ValueError("resource proof requires12GiB host reserve")
    subprocess.run([cargo, "generate-lockfile", "--offline"], cwd=fixture, env=env, check=True, capture_output=True)
    receipts = []
    for label in ["grouped", "ungrouped-negative", "max2-negative"]:
        runtime = output / label
        runtime.mkdir(mode=0o700)
        config = runner.private_config(runtime)
        if label == "ungrouped-negative":
            original = config.read_text()
            a = original.index('[[profile.ci.overrides]]')
            b = original.index('[profile.ci.junit]')
            config.write_text(original[:a] + original[b:])
        elif label == "max2-negative":
            config.write_text(config.read_text().replace("max-threads = 1", "max-threads = 2"))
        environment = {**env, "RESOURCE_ROOT": str(runtime)}
        command = [str(binary), "nextest", "run", "--locked", "--config-file", str(config), "--profile", "ci",
                   "--user-config-file", "none", "--test-threads", "4", "--retries", "0", "--no-fail-fast"]
        started = time.monotonic()
        result = subprocess.run(command, cwd=fixture, env=environment, capture_output=True, text=True, timeout=25)
        (runtime / "stdout").write_text(result.stdout)
        (runtime / "stderr").write_text(result.stderr)
        junit = ET.parse(runtime / "store/ci/junit.xml").getroot()
        assert junit.attrib['tests'] == '6' and junit.attrib['errors'] == '0'
        assert (runtime / "four_concurrent").exists(), "global four-slot scheduling was lost"
        failures = int(junit.attrib['failures'])
        if label == "grouped":
            assert result.returncode == 0 and failures == 0
            assert all((runtime / f"group-{name}").read_text() == 'managed-control-port3211'
                       for name in runner.CONTROL_LISTENER_TESTS)
        else:
            assert result.returncode == 100 and failures >= 1
            assert 'shared listener collision' in result.stderr
        receipts.append({"case": label, "command": command, "exit": result.returncode,
                         "wall_seconds": time.monotonic() - started, "tests": 6, "failures": failures,
                         "four_simultaneously_active": True, "actual_address": (runtime / "address").read_text()})
    (output / "receipt.json").write_text(json.dumps({"tool_sha256": digest, "tool_version": version,
        "source_fixture_sha256": hashlib.sha256(source.encode()).hexdigest(),
        "cargo": subprocess.check_output([cargo, "--version"], text=True).strip(),
        "rustc": subprocess.check_output([rustc, "-vV"], text=True).strip(),
        "cases": receipts, "scope": "tiny independent fixture only; actual NAC/GNU requalification pending"}, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--native-tool":
        native_control(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve())
    elif len(sys.argv) == 4 and sys.argv[1] == "--listener-resource-control":
        listener_resource_control(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve())
    else:
        unittest.main()
