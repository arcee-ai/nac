"""Only complete vulnerability verdicts become advisory during rollout."""
import json
from pathlib import Path
import tempfile
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


class DeferredEnforcementTests(unittest.TestCase):
    def test_blocked_scan_is_reported_without_changing_verdict_or_raw_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = report(root, 1, image=IMAGE, source_revision=SOURCE)
            self.assertEqual(result["security_verdict"], "blocked")
            self.assertEqual(result["enforcement"], "deferred")
            self.assertEqual(result["blocking"], 1)
            for name, contents in before.items():
                self.assertEqual((root / name).read_bytes(), contents)
            self.assertEqual(json.loads((root / "ci-report.json").read_text()), result)

    def test_successful_scan_can_report_without_claiming_enforcement_active(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture(root, False)
            result = report(root, 0)
            self.assertEqual((result["security_verdict"], result["enforcement"]), ("passed", "deferred"))

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
