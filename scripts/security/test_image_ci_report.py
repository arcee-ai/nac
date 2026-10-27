"""Complete evidence survives strict passed, blocked and error outcomes."""
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

from image_ci_report import report
from image_rust import RUST_FILES
from image_inventory import sha256, write_json

IMAGE = "sha256:" + "a" * 64
SOURCE = "b" * 40


def fixture(root, blocked=True):
    identity = {"image": IMAGE, "source_revision": SOURCE}
    files = {"identity.json": identity, "runtime.json": {"probe": "retained"},
             "sbom.syft.json": {"artifacts": ["retained"]}, "coverage.json": {"complete": True}}
    files.update({name: {"fixture": "retained Rust evidence"} for name in RUST_FILES})
    for name, value in files.items():
        write_json(root / name, value)
    write_json(root / "bundle.json", {"schema_version": 2, "image": IMAGE,
               "files": {name: sha256(root / name) for name in files}})
    findings = [{"advisory": "CVE-control", "severity": "High"}] if blocked else []
    write_json(root / "findings.json", findings)
    write_json(root / "policy-result.json", {"blocking": findings, "excepted": [], "reporting": []})
    write_json(root / "result.json", {"status": "blocked" if blocked else "passed", "image": IMAGE,
               "blocking": len(findings), "findings": len(findings)})
    (root / "report.md").write_text("Full image findings remain retained.\n")


class StrictEnforcementTests(unittest.TestCase):
    def test_blocked_scan_is_reported_without_changing_verdict_or_raw_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = report(root, 1, image=IMAGE, source_revision=SOURCE)
            self.assertEqual(result["security_verdict"], "blocked")
            self.assertEqual(result["enforcement"], "strict")
            self.assertEqual(result["blocking"], 1)
            for name, contents in before.items():
                self.assertEqual((root / name).read_bytes(), contents)
            self.assertEqual(json.loads((root / "ci-report.json").read_text()), result)

    def test_successful_scan_reports_strict_verdict(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, False)
            result = report(root, 0)
            self.assertEqual((result["security_verdict"], result["enforcement"]), ("passed", "strict"))

    def test_cli_preserves_exact_exit_and_all_evidence(self):
        script = Path(__file__).with_name("image_ci_report.py")
        for blocked in (True, False):
            with self.subTest(blocked=blocked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                fixture(root, blocked)
                before = {p.name: p.read_bytes() for p in root.iterdir()}
                result = subprocess.run([sys.executable, str(script), "--scan-output", str(root),
                    "--scanner-exit", str(int(blocked)), "--image", IMAGE, "--source-revision", SOURCE],
                    capture_output=True, text=True)
                self.assertEqual(result.returncode, int(blocked), result.stderr)
                self.assertEqual(json.loads((root / "ci-report.json").read_text())["enforcement"], "strict")
                for name, contents in before.items():
                    self.assertEqual((root / name).read_bytes(), contents)

    def test_cli_errors_and_unknown_findings_cannot_return_success(self):
        script = Path(__file__).with_name("image_ci_report.py")
        for status in (1, 2, 137, -9):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                fixture(root)
                finding = {"advisory": "CVE-control", "severity": "Unknown"}
                write_json(root / "findings.json", [finding])
                write_json(root / "policy-result.json", {"blocking": [finding], "excepted": [], "reporting": []})
                result = subprocess.run([sys.executable, str(script), "--scan-output", str(root),
                    "--scanner-exit", str(status)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 1 if status == 1 else 2)
                self.assertEqual((root / "ci-report.json").exists(), status == 1)
                self.assertTrue((root / "findings.json").exists())

    def test_approved_exceptions_and_lower_severities_remain_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, False)
            # Actual trusted exception validation belongs to image-policy tests.
            # The reporter only preserves an already-completed scanner decision.
            approved = {"advisory": "CVE-approved", "severity": "High"}
            lower = {"advisory": "CVE-lower", "severity": "Low"}
            write_json(root / "findings.json", [approved, lower])
            write_json(root / "policy-result.json", {"blocking": [], "excepted": [dict(approved, exception={"reviewed": "fixture"})], "reporting": [lower]})
            write_json(root / "result.json", {"status": "passed", "image": IMAGE, "blocking": 0, "findings": 2})
            result = report(root, 0)
            self.assertEqual((result["findings"], result["blocking"]), (2, 0))
            self.assertEqual(json.loads((root / "findings.json").read_text()), [approved, lower])

    def test_errors_and_cancellation_are_not_converted_even_if_old_complete_files_exist(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            for status in (2, 137, -9):
                with self.subTest(status=status), self.assertRaises(ValueError):
                    report(root, status)
            self.assertFalse((root / "ci-report.json").exists())

    def test_verdict_and_exit_status_must_agree(self):
        for blocked, exit_status in ((True, 0), (False, 1)):
            with self.subTest(blocked=blocked), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                fixture(root, blocked)
                with self.assertRaises(ValueError):
                    report(root, exit_status)
                data = json.loads((root / "result.json").read_text())
                data["status"] = "inventoried"
                write_json(root / "result.json", data)
                with self.assertRaises(ValueError):
                    report(root, 1 if blocked else 0)

    def test_new_disposition_keys_or_changed_rows_cannot_silently_drop_findings(self):
        for mutation in ("unknown-key", "changed-row", "missing-exception"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                fixture(root)
                policy = json.loads((root / "policy-result.json").read_text())
                if mutation == "unknown-key":
                    policy["fixed"] = []
                elif mutation == "changed-row":
                    policy["blocking"][0]["advisory"] = "different-advisory"
                else:
                    policy["excepted"] = policy.pop("blocking")
                    policy["blocking"] = []
                    write_json(root / "result.json", {"status": "passed", "image": IMAGE,
                               "blocking": 0, "findings": 1})
                write_json(root / "policy-result.json", policy)
                with self.assertRaises(ValueError):
                    report(root, 0 if mutation == "missing-exception" else 1)
                self.assertFalse((root / "ci-report.json").exists())

    def test_wrong_image_source_or_changed_retained_input_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            for arguments in ({"image": "sha256:" + "c" * 64}, {"source_revision": "d" * 40}):
                with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                    report(root, 1, **arguments)
            (root / "runtime.json").write_text("altered")
            with self.assertRaisesRegex(ValueError, "altered"):
                report(root, 1)

    def test_missing_or_inconsistent_output_is_not_a_completed_report(self):
        for name in ("result.json", "bundle.json", "policy-result.json", "findings.json", "report.md"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                fixture(root)
                (root / name).unlink()
                with self.assertRaises((ValueError, OSError)):
                    report(root, 1)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            write_json(root / "result.json", {"status": "blocked", "image": IMAGE,
                       "blocking": 0, "findings": 0})
            with self.assertRaisesRegex(ValueError, "counts"):
                report(root, 1)


if __name__ == "__main__":
    unittest.main()
