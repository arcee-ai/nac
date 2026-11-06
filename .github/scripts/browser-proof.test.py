"""Behavioral controls for the browser receipt publication boundary."""

import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("browser-proof.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("browser_proof", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SOURCE = "a" * 40
GOAL = "00000000-0000-4000-8000-000000000001"
RUN = "00000000-0000-4000-8000-000000000002"
CALLS = {
    "g1": {
        "g1-snapshot", "g1-completion-wake", "g1-quiet-settlement",
        "g1-quiet-clear", "g1-restart-cursor", "g1-retained-proof",
    },
    "g2": {
        "g2-passive-before", "g2-snapshot", "g2-input-wait",
        "g2-passive-after-input", "g2-pause-wait", "g2-quiet-settlement",
        "g2-fresh-proof", "g2-passive-final",
    },
}


def fixture(case):
    identity = {
        "source": SOURCE, "binary": "/owned/nac-web", "binary_sha256": "b" * 64,
        "owner": "fixture", "profile": "fixture", "organization": "fixture",
        "host": "fixture", "incarnation": "fixture",
        "release": json.dumps(["fixture", "fixture", "fixture", SOURCE]),
    }
    goal = {"goal_id": GOAL, "accounting_run_id": RUN, "version": 1}
    target = {
        "session_id": "target", "mode": "goal", "resolved_identity": GOAL,
        "status": "completed", "after_cursor": "cursor",
        "proof": {"goal_id": GOAL, "last_run_id": RUN, "version": 1, "retained": True},
    }
    calls = {}
    for name in CALLS[case]:
        if name in {"g2-passive-before", "g2-passive-after-input", "g2-passive-final"}:
            calls[name] = {
                "status": "completed", "task": {
                    "session_id": "target", "project_id": "project",
                    "durable": {"goal": {"goal_id": GOAL}}, "ephemeral": {},
                },
            }
        else:
            calls[name] = {"status": "completed", "targets": [copy.deepcopy(target)]}
    value = {
        "identity": identity,
        "initial": {"target": "target", "caller": "caller", "project": "project", "goal": goal},
        "calls": calls,
        "settled": {**goal, "status": "completed", "last_failure": None},
        "verified_read": "native read verified",
    }
    if case == "g1":
        value.update(restarted=copy.deepcopy(identity), native_complete="native complete")
    else:
        value["human_pause"] = {"http_status": 200, "goal": copy.deepcopy(goal)}
    return value


class BrowserProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.paths = {}
        for case in CALLS:
            directory = self.root / case
            directory.mkdir()
            proof = directory / f"all471-{case}-proof.json"
            proof.write_text(json.dumps(fixture(case)))
            cleanup = directory / f"all471-{case}-cleanup.json"
            cleanup.write_text(json.dumps({
                "pid": 123, "binaryPath": "/owned/nac-web", "baseUrl": "http://127.0.0.1:1234",
                "provider": "http://127.0.0.1:5678", "exitCode": 0, "signalCode": None,
            }))
            self.paths[case] = (proof, cleanup)

    def reject(self):
        with self.assertRaises((AssertionError, ValueError, KeyError, OSError, TypeError)):
            MODULE.stage(self.root, SOURCE)
        self.assertFalse((self.root / "all471-goal-proof-artifact").exists())

    def mutate(self, case, change):
        proof = self.paths[case][0]
        value = json.loads(proof.read_text())
        change(value)
        proof.write_text(json.dumps(value))

    def test_stages_exactly_four_receipts_and_digest_manifest(self):
        MODULE.stage(self.root, SOURCE)
        output = self.root / "all471-goal-proof-artifact"
        manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["source_revision"], SOURCE)
        self.assertEqual(len(manifest["files"]), 4)
        self.assertEqual(len(list(output.iterdir())), 5)
        for name, record in manifest["files"].items():
            payload = (output / name).read_bytes()
            self.assertEqual(record["bytes"], len(payload))
            self.assertEqual(record["sha256"], MODULE.hashlib.sha256(payload).hexdigest())

    def test_missing_case_is_not_publishable(self):
        self.paths["g2"][0].unlink()
        self.reject()

    def test_duplicate_case_is_not_publishable(self):
        directory = self.root / "duplicate"
        directory.mkdir()
        (directory / self.paths["g1"][0].name).write_bytes(self.paths["g1"][0].read_bytes())
        self.reject()

    def test_wrong_candidate_is_not_publishable(self):
        self.mutate("g1", lambda value: value["identity"].update(source="c" * 40))
        self.reject()

    def test_restart_must_retain_candidate_identity(self):
        self.mutate("g1", lambda value: value["restarted"].update(source="c" * 40))
        self.reject()

    def test_release_identity_must_match_candidate(self):
        self.mutate("g2", lambda value: value["identity"].update(release='["x","x","x","wrong"]'))
        self.reject()

    def test_missing_required_call_is_not_publishable(self):
        self.mutate("g1", lambda value: value["calls"].pop("g1-quiet-clear"))
        self.reject()

    def test_wrong_goal_receipt_is_not_publishable(self):
        self.mutate("g2", lambda value: value["calls"]["g2-fresh-proof"]["targets"][0].update(resolved_identity=RUN))
        self.reject()

    def test_wrong_accounting_run_is_not_publishable(self):
        self.mutate("g1", lambda value: value["calls"]["g1-retained-proof"]["targets"][0]["proof"].update(last_run_id=GOAL))
        self.reject()

    def test_unsettled_cleanup_is_not_publishable(self):
        cleanup = self.paths["g2"][1]
        value = json.loads(cleanup.read_text())
        value.update(exitCode=None, signalCode=None)
        cleanup.write_text(json.dumps(value))
        self.reject()

    def test_cleanup_binary_must_match_verified_binary(self):
        cleanup = self.paths["g1"][1]
        value = json.loads(cleanup.read_text())
        value["binaryPath"] = "/different/nac-web"
        cleanup.write_text(json.dumps(value))
        self.reject()

    def test_symlinked_receipt_is_not_publishable(self):
        proof = self.paths["g1"][0]
        saved = self.root / "saved.json"
        proof.rename(saved)
        proof.symlink_to(saved)
        self.reject()

    def test_symlinked_parent_is_not_publishable(self):
        original = self.root / "g1"
        moved = self.root / "saved"
        original.rename(moved)
        original.symlink_to(moved, target_is_directory=True)
        self.reject()

    def test_oversized_input_is_not_publishable(self):
        self.paths["g1"][0].write_bytes(b" " * 131073)
        self.reject()

    def test_optimized_python_fails_closed(self):
        result = subprocess.run([
            sys.executable, "-O", str(SCRIPT), "--root", str(self.root), "--source", SOURCE,
        ], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("assertions enabled", result.stderr)
        self.assertFalse((self.root / "all471-goal-proof-artifact").exists())


if __name__ == "__main__":
    unittest.main()
