#!/usr/bin/env python3
"""Characterize the literal container script and its bootstrap assertions."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def capture(source, directory):
    start = re.search(r'^"\$container_runtime" exec(?: -i)? "\$container_name" /bin/sh -(?:ceu|seu)',
                      source, re.MULTILINE)
    if start is None:
        raise AssertionError("runtime assertion invocation missing")
    end = source.index("\n# Exercise clean/smudge", start.start())
    runtime, result = directory / "runtime", directory / "capture.json"
    runtime.write_text("#!/usr/bin/env python3\nimport json,os,sys\nfrom pathlib import Path\n"
                       "Path(os.environ['SMOKE_CAPTURE']).write_text(json.dumps("
                       "{'argv':sys.argv[1:],'stdin':sys.stdin.read()}))\n")
    runtime.chmod(0o755)
    environment = dict(os.environ, container_runtime=str(runtime), container_name="fixture",
                       SMOKE_CAPTURE=str(result))
    subprocess.run(["/bin/sh", "-c", source[start.start():end]], env=environment,
                   input="", text=True, capture_output=True, check=True)
    return json.loads(result.read_text())


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        captured = capture((ROOT / "scripts/smoke-managed-image.sh").read_text(), self.directory)
        self.assertEqual(captured["argv"], ["exec", "-i", "fixture", "/bin/sh", "-seu"])
        self.payload = captured["stdin"]
        self.assertTrue(self.payload.strip())

    def test_literal_payload_preserves_complete_bootstrap_assertions(self):
        subprocess.run(["/bin/sh", "-n"], input=self.payload, text=True,
                       capture_output=True, check=True)
        for predicate in ('.client_id == "managed-nac"', '.auth_issuer == "https://api.arcee.ai"',
                          '.managed_bootstrap.bootstrap_id == "4712bc5e-30d5-421a-b416-8291d9f7d8f9"'):
            self.assertIn(predicate, self.payload)
        self.assertIn("overwritten > /run/secrets/nac/bootstrap.json", self.payload)

    def run_bootstrap_assertions(self, *, wrong_identity=False, writable=False, payload=None):
        actual_jq = shutil.which("jq")
        if actual_jq is None:
            self.skipTest("bootstrap predicate execution requires jq; literal payload capture remains covered")
        fixture = json.loads((ROOT / "docker/managed/fixtures/bootstrap.json").read_text())
        auth = {"client_id": "wrong" if wrong_identity else fixture["client_id"],
                "auth_issuer": fixture["auth_issuer"],
                "managed_bootstrap": {"bootstrap_id": fixture["bootstrap_id"]}}
        paths = {path: self.directory / name for path, name in [
            ("/repositories", "repositories"), ("/var/lib/nac", "state"),
            ("/home/nac", "home"), ("/run/secrets/nac", "secrets")]}
        for path in paths.values():
            path.mkdir()
        for name in ("repositories", "state", "home"):
            (self.directory / name / "restart-canary").write_text("durable\n")
        auth_path = self.directory / "state/arcee_auth.json"
        (self.directory / "state/arcee_managed_bootstrap_receipt.json").write_text("{}")
        bootstrap_path = self.directory / "secrets/bootstrap.json"
        auth_path.write_text(json.dumps(auth))
        bootstrap_path.write_text("fixture-only\n")
        bootstrap_path.chmod(0o600 if writable else 0o400)
        # Execute the complete captured script with fixture-only paths and tool
        # version stubs. Use real jq so the auth predicate and its exit behavior
        # are exercised. The native image lane still proves actual tool/mounts.
        binary = self.directory / "bin"
        binary.mkdir()
        tools = re.search(r"for tool in ([^;]+); do", self.payload)[1].split()
        versions = {"id": "10001", "rustc": "rustc 1.98.0", "node": "v24.22.1",
                    "go": "go version go1.27.3 linux/amd64", "uv": "uv 0.13.4"}
        for tool in [*tools, "id"]:
            self.assertRegex(tool, r"^[a-z0-9-]+$")
            target = binary / tool
            target.write_text('#!/bin/sh\nprintf "%s\\n" ' + shlex.quote(versions.get(tool, "")) + "\n")
            target.chmod(0o755)
        for tool in ("jq", "grep", "cat", "wc"):
            target = binary / tool
            target.unlink(missing_ok=True)
            target.symlink_to(actual_jq if tool == "jq" else shutil.which(tool))
        script = self.payload if payload is None else payload
        for path, target in paths.items():
            script = script.replace(path, shlex.quote(str(target)))
        script += '\nprintf "assertions-finished\\n"\n'
        result = subprocess.run(["/bin/sh", "-ceu", script], stdin=subprocess.DEVNULL,
                                env=dict(os.environ, PATH=str(binary)), text=True, capture_output=True)
        return result, bootstrap_path.read_text()

    @unittest.skipIf(os.geteuid() == 0, "read-only file characterization requires an unprivileged host user")
    def test_auth_and_read_only_assertions_both_execute(self):
        result, contents = self.run_bootstrap_assertions()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "assertions-finished\n")
        self.assertEqual(contents, "fixture-only\n")

    def test_wrong_auth_identity_fails_before_write_probe(self):
        result, contents = self.run_bootstrap_assertions(wrong_identity=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("bootstrap-auth-identity", result.stderr)
        self.assertNotIn("assertions-finished", result.stdout)
        self.assertEqual(contents, "fixture-only\n")

    def test_writable_bootstrap_fails_the_existing_write_assertion(self):
        result, contents = self.run_bootstrap_assertions(writable=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("bootstrap mount unexpectedly accepted a write", result.stderr)
        self.assertNotIn("assertions-finished", result.stdout)
        self.assertEqual(contents, "overwritten\n")

    def test_split_quoted_command_reproduces_no_input_jq_exit_four(self):
        broken = ("\"$container_runtime\" exec \"$container_name\" /bin/sh -ceu '" + self.payload +
                  "'\n# Exercise clean/smudge")
        captured = capture(broken, self.directory)
        self.assertGreater(len(captured["argv"]), 5)
        original_payload = captured["argv"][4]
        self.assertTrue(original_payload.rstrip().endswith("jq -e .client_id"))
        result, contents = self.run_bootstrap_assertions(payload=original_payload)
        self.assertEqual(result.returncode, 4)
        self.assertNotIn("assertions-finished", result.stdout)
        self.assertEqual(contents, "fixture-only\n")


if __name__ == "__main__":
    unittest.main()
