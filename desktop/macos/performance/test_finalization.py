"""Inert actual-main finalization controls; every process/probe seam is stubbed."""

import copy
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import run as performance


class FinalizationContract(unittest.TestCase):
    def exercise(self, *, original_error=ValueError("original attempted operation"),
                 probe="timeout", stop_error=False, export_error=None):
        temporary = tempfile.TemporaryDirectory(prefix="nac353-finalization-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        contract = copy.deepcopy(json.loads((performance.HERE / "allocation-v2.json").read_text()))
        contract.update(nominated_target_sha="a" * 40, nominated_harness_sha="b" * 40,
                        dispatch_reference="inert-finalization-control")
        (root / "contract.json").write_text(json.dumps(contract))
        (root / "epoch.json").write_text('{"monotonic_ns":100000000000}')
        output = root / "output"
        stopped = []
        samples = []

        def attempted(runner):
            runner.report["commands"] = [{"name": "inert-attempt", "exit_code": 17}]
            runner.report["result"] = "INERT_ATTEMPT_COMPLETED_UNQUALIFIED"
            (runner.private / "00-command.log").write_text("retained inert command history")
            (runner.private / "retained-original.json").write_text(json.dumps({"path": str(runner.private)}))
            def stop(pid):
                stopped.append(pid)
                if stop_error and pid == 52:
                    raise OSError("inert owned stop failure")
            runner.owned = [SimpleNamespace(process=SimpleNamespace(pid=pid),
                            stop=lambda pid=pid: stop(pid)) for pid in (51, 52)]
            if probe is not None:
                runner.sampler = object.__new__(performance.Sampler)
                runner.sampler.binary = runner.private / "probe-not-executed"
                runner.sampler.roots = {pid: {"role": "shell", "receipt": {
                    "kind": "xcui_launch", "pid": pid, "executable": "/inert/owned-app",
                    "launch_unix_us": "123"}} for pid in (4242, 4243)}
                if probe == "expired":
                    runner.deadline = 100
            if original_error is not None:
                raise original_error

        def inert_probe(argv, **options):
            samples.append(argv)
            self.assertEqual(options["timeout"], 3)
            if probe == "timeout" or probe == "partial" and int(argv[-1]) == 4243:
                raise subprocess.TimeoutExpired(argv, 3)
            raw = b"invalid JSON" if probe == "invalid" else json.dumps({
                "schema": "nac-mac-process-v1", "pid": int(argv[-1]),
                "status": "unavailable", "errno": 3}).encode()
            return SimpleNamespace(returncode=2, stdout=raw)

        original_read = Path.read_text
        original_mkdir = Path.mkdir
        def read(path, *args, **kwargs):
            if export_error == "read" and path.name == "retained-original.json":
                raise OSError("inert export read failure")
            return original_read(path, *args, **kwargs)
        def mkdir(path, *args, **kwargs):
            if export_error == "destination" and path == output:
                raise PermissionError("inert unavailable export destination")
            return original_mkdir(path, *args, **kwargs)

        args = ["--calibrate", "--contract", str(root / "contract.json"),
            "--target-sha", "a" * 40, "--harness-sha", "b" * 40, "--tools-sha", "c" * 40,
            "--dispatch-reference", "inert-finalization-control", "--epoch", str(root / "epoch.json"),
            "--source-root", str(root / "target"), "--harness-root", str(root / "harness"),
            "--tools-root", str(performance.HERE.parents[2]), "--performance-source-sha256",
            performance.digest(performance.HERE / "PerformanceJourneys.swift"), "--output", str(output)]
        with patch.object(performance.os, "uname", return_value=SimpleNamespace(sysname="Darwin", machine="arm64")), \
                patch.object(performance.time, "monotonic", return_value=100), \
                patch.object(performance.Calibration, "run", attempted), \
                patch.object(performance.subprocess, "run", side_effect=inert_probe), \
                patch.object(performance.subprocess, "Popen", side_effect=AssertionError("no process")), \
                patch.object(performance, "OwnedCommand", side_effect=AssertionError("no command")), \
                patch.object(performance, "PerformanceDriver", side_effect=AssertionError("no driver")), \
                patch.object(performance.os, "killpg", side_effect=AssertionError("no signaling")), \
                patch.object(performance.time, "sleep", side_effect=AssertionError("no waiting")), \
                patch.object(Path, "read_text", read), patch.object(Path, "mkdir", mkdir):
            self.assertEqual(performance.main(args), 2)
        self.assertEqual(stopped, [52, 51])
        private = root / "output-private"
        report = json.loads((output / "attempt.json").read_text()) if (output / "attempt.json").exists() else None
        return report, output, private, samples

    def assert_original(self, report):
        self.assertEqual(report["result"], "PREREQUISITE_OR_CALIBRATION_FAILED")
        self.assertEqual(report["error_type"], "ValueError")
        self.assertEqual(report["error"], "original attempted operation")
        self.assertEqual(report["commands"], [{"name": "inert-attempt", "exit_code": 17}])
        self.assertFalse(report["measurement_ready"])
        self.assertIsNone(report["numerical_product_budgets"])

    def assert_index(self, output):
        index = json.loads((output / "evidence-index.json").read_text())
        self.assertIn("retained-original.json", index)
        self.assertIn("00-command.log", index)
        for name, expected in index.items():
            self.assertEqual(performance.digest(output / name), expected)
        self.assertEqual(json.loads((output / "retained-original.json").read_text())["path"], "<private-fixture>")

    def test_probe_timeout_retains_original_attempt_and_exports_hashes(self):
        report, output, _, samples = self.exercise()
        self.assert_original(report)
        self.assertEqual(report["cleanup_error"]["error_type"], "TimeoutExpired")
        self.assertFalse(report["recorded_process_cleanup_verified"])
        self.assertFalse(report["whole_process_set_cleanup_verified"])
        self.assertEqual(report["cleanup_unresolved_recorded_pids"], [4242, 4243])
        self.assertEqual(len(samples), 1)
        self.assert_index(output)

    def test_invalid_probe_after_completed_attempt_is_retained_as_unknown(self):
        report, output, _, _ = self.exercise(original_error=None, probe="invalid")
        self.assertNotEqual(report["result"], "ADMISSION_REFUSED")
        self.assertEqual(report["cleanup_error"]["error_type"], "JSONDecodeError")
        self.assertFalse(report["recorded_process_cleanup_verified"])
        self.assertEqual(report["cleanup_unresolved_recorded_pids"], [4242, 4243])
        self.assert_index(output)

    def test_one_owned_stop_failure_does_not_skip_other_cleanup_or_export(self):
        report, output, _, _ = self.exercise(probe=None, stop_error=True)
        self.assert_original(report)
        self.assertEqual(report["cleanup"], [{"created_pid": 52, "reaped": False, "error_type": "OSError"},
                                             {"created_pid": 51, "reaped": True}])
        self.assertFalse(report["whole_process_set_cleanup_verified"])
        self.assert_index(output)

    def test_original_failure_survives_successful_recorded_cleanup(self):
        report, output, _, _ = self.exercise(probe="dead")
        self.assert_original(report)
        self.assertTrue(report["recorded_process_cleanup_verified"])
        self.assertFalse(report["whole_process_set_cleanup_verified"])
        self.assertEqual(report["cleanup_unresolved_recorded_pids"], [])
        self.assertNotIn("cleanup_error", report)
        self.assert_index(output)

    def test_partial_cleanup_retains_only_unresolved_identity_after_probe_failure(self):
        report, output, _, samples = self.exercise(probe="partial")
        self.assert_original(report)
        self.assertEqual(report["cleanup_unresolved_recorded_pids"], [4243])
        self.assertFalse(report["recorded_process_cleanup_verified"])
        self.assertEqual(len(samples), 2)
        self.assert_index(output)

    def test_expired_cleanup_guard_exports_without_sampling_or_verified_claim(self):
        report, output, _, samples = self.exercise(probe="expired")
        self.assert_original(report)
        self.assertFalse(report["recorded_process_cleanup_verified"])
        self.assertEqual(report["cleanup_unresolved_recorded_pids"], [4242, 4243])
        self.assertEqual(samples, [])
        self.assert_index(output)

    def test_partial_export_failure_retains_work_cleanup_and_export_errors(self):
        report, output, private, _ = self.exercise(export_error="read")
        self.assert_original(report)
        self.assertEqual(report["cleanup_error"]["error_type"], "TimeoutExpired")
        self.assertEqual(report["export_error"]["error_type"], "OSError")
        self.assertFalse(report["evidence_export_complete"])
        self.assertFalse((output / "evidence-index.json").exists())
        self.assertTrue((private / "export-failure.json").exists())

    def test_unwritable_export_keeps_private_history_without_false_admission(self):
        report, output, private, _ = self.exercise(export_error="destination")
        self.assertIsNone(report)
        self.assertFalse(output.exists())
        retained = json.loads((private / "export-failure.json").read_text())
        self.assert_original(retained)
        self.assertEqual(retained["export_error"]["error_type"], "PermissionError")

    def test_admission_refusal_still_never_constructs_or_runs_a_calibration(self):
        with tempfile.TemporaryDirectory(prefix="nac353-refusal-") as folder:
            output = Path(folder) / "output"
            with patch.object(performance, "Calibration", side_effect=AssertionError("not admitted")), \
                    patch.object(performance.subprocess, "Popen", side_effect=AssertionError("no process")):
                self.assertEqual(performance.main(["--calibrate", "--output", str(output)]), 2)
            report = json.loads((output / "attempt.json").read_text())
            self.assertEqual(report["result"], "ADMISSION_REFUSED")
            self.assertFalse(report["measurement_ready"])


if __name__ == "__main__":
    unittest.main()
