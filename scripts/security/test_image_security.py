#!/usr/bin/env python3
"""Behavioral negative tests; live tool/advisory qualification is a separate lane."""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import image_inventory as inv
import image_scan as scan
import image_rescan as rescan
import image_prepublication as publication

IMAGE = "sha256:" + "1" * 64
NOW = dt.datetime(2026, 10, 21, 12, tzinfo=dt.timezone.utc)
RUNTIME = {"nac": "nac-web 0.1.0 (abcdef123456)", "node": "v24.22.1", "go": "go version go1.27.3 linux/amd64",
           "uv": "uv 0.13.4 (abc 2026-10-20)", "dpkg": "base-files\t12.4+deb12u12"}
SBOM = {"descriptor": {"name": "syft"}, "source": {"type": "image", "metadata": {"imageID": IMAGE}},
        "distro": {"id": "debian"}, "artifacts": [
            {"id": "os", "name": "base-files", "version": "12.4+deb12u12", "type": "deb"},
            {"id": "node", "name": "node", "version": "24.22.1", "type": "binary",
             "cpes": [{"cpe": "cpe:2.3:a:nodejs:node.js:24.22.1:*:*:*:*:*:*:*"}]}]}
DB = {"valid": True, "built": "2026-10-21T06:00:00Z", "schemaVersion": "v6.1.10", "path": "/db"}


class InventoryTests(unittest.TestCase):
    def test_complete_inventory(self):
        result = inv.inventory(SBOM, RUNTIME, IMAGE)
        self.assertEqual(result["versions"]["uv"], "0.13.4")
        self.assertEqual(result["os_packages"], 1)

    def test_missing_unknown_or_empty_runtime_fails(self):
        for runtime in ("node", "go", "uv", "dpkg"):
            for value in ("", "unrecognized"):
                with self.subTest(runtime=runtime, value=value), self.assertRaises(ValueError):
                    inv.inventory(SBOM, dict(RUNTIME, **{runtime: value}), IMAGE)

    def test_inventory_incomplete_or_wrong_image_fails(self):
        for field in ("artifacts", "distro", "source"):
            broken = copy.deepcopy(SBOM)
            broken.pop(field)
            with self.subTest(field=field), self.assertRaises(ValueError):
                inv.inventory(broken, RUNTIME, IMAGE)
        with self.assertRaises(ValueError):
            inv.inventory(SBOM, RUNTIME, "sha256:" + "2" * 64)

    def test_node_requires_actual_version_and_advisory_identifier(self):
        for field, value in [("version", "1.0.0"), ("cpes", [])]:
            broken = copy.deepcopy(SBOM)
            broken["artifacts"][1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                inv.inventory(broken, RUNTIME, IMAGE)

    def test_every_installed_os_package_is_required(self):
        with self.assertRaisesRegex(ValueError, "OS package not inventoried"):
            inv.inventory(SBOM, dict(RUNTIME, dpkg=RUNTIME["dpkg"] + "\nopenssl\t3.0.0"), IMAGE)

    def test_database_measures_build_time_not_download_time(self):
        self.assertEqual(inv.database(DB, NOW)["age_seconds"], 21600)
        for value in (dict(DB, built="2026-10-20T11:59:59Z"), dict(DB, valid=False),
                      dict(DB, built="2026-10-22T00:00:00Z"), dict(DB, error="network"), {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                inv.database(value, NOW)

    def test_grype_retains_all_severities_and_fixes(self):
        matches = [{"artifact": SBOM["artifacts"][1], "vulnerability": {
                    "id": f"CVE-{severity}", "severity": severity, "fix": {"versions": ["25.0.0"]}}}
                   for severity in ("Low", "Medium", "High", "Critical", "Unknown")]
        findings = inv.grype_findings({"descriptor": {"name": "grype"}, "matches": matches}, SBOM)
        self.assertEqual(len(findings), 5)
        self.assertEqual(findings[0]["context"], "managed-image")
        self.assertEqual(findings[0]["package"], "binary:node")
        with self.assertRaises(ValueError):
            inv.grype_findings({}, SBOM)

    def test_supplemental_advisory_matching_and_unknown_severity(self):
        self.assertEqual(inv.osv_findings({}, "uv", "PyPI", "0.13.4"), [])
        vuln = {"id": "GHSA-fixture", "affected": [{"package": {"name": "uv", "ecosystem": "PyPI"}}]}
        finding = inv.osv_findings({"vulns": [vuln]}, "uv", "PyPI", "0.12.1")[0]
        self.assertEqual(finding["severity"], "Unknown")
        self.assertEqual(finding["package"], "PyPI:uv")
        for response in ({"error": "unavailable"}, {"vulns": None}, {"vulns": [{}]}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                inv.osv_findings(response, "uv", "PyPI", "0.12.1")


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_tool_failure_never_succeeds(self):
        with self.assertRaisesRegex(ValueError, "command failed"):
            scan.command(["python3", "-c", "raise SystemExit(7)"])

    def test_candidate_cannot_supply_new_suppression(self):
        trusted, candidate = self.root / "trusted.json", self.root / "candidate.json"
        trusted.write_text('{"schema_version":1,"exceptions":[]}')
        candidate.write_text('{"schema_version":1,"exceptions":[{}]}')
        with self.assertRaisesRegex(ValueError, "candidate changes exception policy"):
            scan.evaluate([], trusted, candidate, self.root)

    def test_environment_cannot_override_scanner_policy(self):
        with patch.dict("os.environ", {"GRYPE_ONLY_FIXED": "true", "SYFT_EXCLUDE": "/**"}):
            environment = scan.scanner_environment(self.root)
        self.assertNotIn("GRYPE_ONLY_FIXED", environment)
        self.assertNotIn("SYFT_EXCLUDE", environment)

    def test_unchanged_bundle_is_bound_to_exact_bytes(self):
        for name, value in [("sbom.syft.json", SBOM), ("runtime.json", RUNTIME),
                            ("identity.json", {"image": IMAGE}), ("coverage.json", {})]:
            inv.write_json(self.root / name, value)
        scan.bundle_manifest(self.root, IMAGE)
        output = self.root / "rescan"
        output.mkdir()
        self.assertEqual(scan.load_bundle(self.root, output)["image"], IMAGE)
        (self.root / "runtime.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            scan.load_bundle(self.root, output)

    def test_daily_selection_rejects_pr_expired_and_foreign_evidence(self):
        run = {"id": 12, "event": "push", "head_branch": "dev", "status": "completed",
               "conclusion": "failure", "head_sha": "a" * 40, "created_at": "2026-10-21T06:00:00Z",
               "head_repository": {"full_name": "arcee-ai/nac"}}
        artifact = {"name": "managed-image-security-" + "a" * 40, "expired": False}
        self.assertEqual(rescan.select_run([run], {12: [artifact]}, NOW)[0], run)
        for replacement in ({"event": "pull_request"}, {"head_branch": "other"},
                            {"created_at": "2026-10-01T00:00:00Z"},
                            {"head_repository": {"full_name": "fork/nac"}}):
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                rescan.select_run([dict(run, **replacement)], {12: [artifact]}, NOW)
        with self.assertRaises(ValueError):
            rescan.select_run([run], {12: [dict(artifact, expired=True)]}, NOW)

    def test_failed_security_prevents_publication_gate_receipt(self):
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40,
                                  trusted_policy=self.root / "trusted", candidate_policy=self.root / "candidate",
                                  output=self.root / "evidence")
        with patch.object(publication, "command") as smoke, patch.object(publication.subprocess, "run") as security:
            security.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, "publication blocked"):
                publication.gate(args)
            self.assertEqual(smoke.call_args.kwargs["env"]["MANAGED_IMAGE"], IMAGE)
            self.assertEqual(smoke.call_args.kwargs["env"]["MANAGED_IMAGE_SKIP_BUILD"], "1")
        self.assertFalse((args.output / "publication-gate.json").exists())

    def test_floating_input_fails_before_docker_or_network(self):
        args = argparse.Namespace(image="nac:latest", source_revision="a" * 40, output=self.root / "evidence")
        with patch.object(scan, "command") as command:
            self.assertEqual(scan.run(args), 2)
        command.assert_not_called()
        self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")


if __name__ == "__main__":
    unittest.main()
