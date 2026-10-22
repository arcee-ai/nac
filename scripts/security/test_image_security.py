#!/usr/bin/env python3
"""Behavioral negative tests; live tool/advisory qualification is a separate lane."""
import argparse
import base64
import hashlib
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import image_inventory as inv
import image_scan as scan
import image_rescan as rescan
import image_prepublication as publication
import image_qualify as qualification

IMAGE = "sha256:" + "1" * 64
NOW = dt.datetime(2026, 10, 21, 12, tzinfo=dt.timezone.utc)
RUNTIME = {"os_release": 'ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n', "nac": "nac-web 0.1.0 (abcdef123456)", "node": "v24.22.1", "go": "go version go1.27.3 linux/amd64",
           "gh": "gh version 2.103.0 (2026-10-21)\nhttps://github.com/cli/cli/releases/tag/v2.103.0",
           "git_lfs": "git-lfs/3.8.0 (GitHub; linux amd64; go 1.27.3; git aece9221f8c09221a14395d964806b956289bc07)",
           "uv": "uv 0.13.4 (abc 2026-10-20)", "dpkg": "base-files\t12.4+deb12u12"}
SBOM = {"descriptor": {"name": "syft"}, "source": {"type": "image", "metadata": {"imageID": IMAGE}},
        "distro": {"id": "debian", "versionID": "12", "versionCodename": "bookworm"}, "artifacts": [
            {"id": "os", "name": "base-files", "version": "12.4+deb12u12", "type": "deb"},
            {"id": "node", "name": "node", "version": "24.22.1", "type": "binary",
             "cpes": [{"cpe": "cpe:2.3:a:nodejs:node.js:24.22.1:*:*:*:*:*:*:*"}]},
            {"id": "gh", "name": "github.com/cli/cli/v2", "version": "v2.103.0", "type": "go-module",
             "locations": [{"path": "/usr/local/bin/gh"}], "metadata": {"mainModule": "github.com/cli/cli/v2"}},
            {"id": "lfs", "name": "github.com/git-lfs/git-lfs/v3", "version": "UNKNOWN", "type": "go-module",
             "locations": [{"path": "/usr/local/bin/git-lfs"}], "metadata": {"mainModule": "github.com/git-lfs/git-lfs/v3"}}]}
DB = {"valid": True, "built": "2026-10-21T06:00:00Z", "schemaVersion": "v6.1.10", "path": "/db"}
PINS = {"GH_VERSION": "2.103.0", "GIT_LFS_VERSION": "3.8.0",
        "GIT_LFS_REVISION": "aece9221f8c09221a14395d964806b956289bc07"}
DOCKERFILE_PINS = "\n".join(f"ARG {name}={value}" for name, value in PINS.items())


class InventoryTests(unittest.TestCase):
    def test_supported_release_inventory_and_scanner_must_agree(self):
        for version, codename in [("12", "bookworm"), ("13", "trixie")]:
            with self.subTest(version=version):
                sbom = copy.deepcopy(SBOM)
                sbom["distro"] = {"id": "debian", "versionID": version,
                                 "versionCodename": codename}
                runtime = dict(RUNTIME, os_release=f"ID=debian\nVERSION_ID={version}\nVERSION_CODENAME={codename}\n")
                self.assertEqual(inv.inventory(sbom, runtime, IMAGE, expected_pins=PINS)["os_release"]["VERSION_ID"], version)
                report = {"descriptor": {"name": "grype"}, "matches": [],
                          "distro": {"name": "debian", "version": version + ".7"}}
                self.assertEqual(inv.grype_findings(report, sbom), [])
                other = "12" if version == "13" else "13"
                report["distro"]["version"] = other
                with self.assertRaisesRegex(ValueError, "differs"):
                    inv.grype_findings(report, sbom)
                sbom["distro"]["versionID"] = other
                with self.assertRaisesRegex(ValueError, "differs"):
                    inv.inventory(sbom, runtime, IMAGE, expected_pins=PINS)

    def test_complete_inventory(self):
        result = inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=PINS)
        self.assertEqual(result["versions"]["uv"], "0.13.4")
        self.assertEqual(result["os_packages"], 1)

    def test_source_pin_parser_rejects_missing_duplicate_and_malformed_pins(self):
        self.assertEqual(inv.managed_go_pins(DOCKERFILE_PINS), PINS)
        for source in ("", DOCKERFILE_PINS + "\nARG GH_VERSION=3.0.0",
                       DOCKERFILE_PINS.replace(PINS["GIT_LFS_REVISION"], "short")):
            with self.subTest(source=source), self.assertRaises(ValueError):
                inv.managed_go_pins(source)

    def test_missing_unknown_or_empty_runtime_fails(self):
        for runtime in ("node", "go", "uv", "gh", "git_lfs", "dpkg"):
            for value in ("", "unrecognized"):
                with self.subTest(runtime=runtime, value=value), self.assertRaises(ValueError):
                    inv.inventory(SBOM, dict(RUNTIME, **{runtime: value}), IMAGE, expected_pins=PINS)

    def test_inventory_incomplete_or_wrong_image_fails(self):
        for field in ("artifacts", "distro", "source"):
            broken = copy.deepcopy(SBOM)
            broken.pop(field)
            with self.subTest(field=field), self.assertRaises(ValueError):
                inv.inventory(broken, RUNTIME, IMAGE, expected_pins=PINS)
        with self.assertRaises(ValueError):
            inv.inventory(SBOM, RUNTIME, "sha256:" + "2" * 64, expected_pins=PINS)

    def test_unrecognized_or_mismatched_actual_os_release_fails(self):
        for release in ('ID=debian\nVERSION_ID=unknown\nVERSION_CODENAME=bookworm',
                        'ID=debian\nVERSION_ID=14\nVERSION_CODENAME=forky',
                        'ID=debian\nVERSION_ID=13\nVERSION_CODENAME=bookworm',
                        'ID=debian\nVERSION_ID=13\nVERSION_CODENAME=trixie',
                        'ID=ubuntu\nVERSION_ID=12\nVERSION_CODENAME=bookworm', ''):
            with self.subTest(release=release), self.assertRaises(ValueError):
                inv.inventory(SBOM, dict(RUNTIME, os_release=release), IMAGE, expected_pins=PINS)
        for distro in ({"id": "debian", "versionID": "unknown"},
                       {"id": "debian", "versionID": "13", "versionCodename": "trixie"}):
            with self.subTest(distro=distro), self.assertRaises(ValueError):
                inv.inventory(dict(SBOM, distro=distro), RUNTIME, IMAGE, expected_pins=PINS)

    def test_unrecognized_grype_distro_is_incomplete_even_with_no_matches(self):
        report = {"descriptor": {"name": "grype"}, "matches": [],
                  "distro": {"name": "debian", "version": "unknown"}}
        with self.assertRaisesRegex(ValueError, "Debian"):
            inv.grype_findings(report, SBOM)

    def test_containerd_identity_is_bound_to_requested_id_and_verified_config(self):
        sbom = copy.deepcopy(SBOM)
        config = b'{"architecture":"amd64","os":"linux"}'
        sbom["source"]["metadata"] = {"userInput": IMAGE, "config": base64.b64encode(config).decode(),
                                           "imageID": "sha256:" + hashlib.sha256(config).hexdigest()}
        inv.inventory(sbom, RUNTIME, IMAGE, expected_pins=PINS)
        sbom["source"]["metadata"]["config"] = base64.b64encode(b"different").decode()
        with self.assertRaisesRegex(ValueError, "config identity mismatch"):
            inv.inventory(sbom, RUNTIME, IMAGE, expected_pins=PINS)

    def test_node_requires_actual_version_and_advisory_identifier(self):
        for field, value in [("version", "1.0.0"), ("cpes", [])]:
            broken = copy.deepcopy(SBOM)
            broken["artifacts"][1][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                inv.inventory(broken, RUNTIME, IMAGE, expected_pins=PINS)

    def test_every_installed_os_package_is_required(self):
        with self.assertRaisesRegex(ValueError, "OS package not inventoried"):
            inv.inventory(SBOM, dict(RUNTIME, dpkg=RUNTIME["dpkg"] + "\nopenssl\t3.0.0"), IMAGE, expected_pins=PINS)

    def test_go_applications_require_actual_binary_main_modules_and_versions(self):
        coverage = inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=PINS)
        self.assertEqual(coverage["go_applications"]["git_lfs"]["version"], "3.8.0")
        for index in (2, 3):
            for field, value in [("version", "v0.1.0"), ("locations", [{"path": "/tmp/unrelated"}]),
                                 ("metadata", {"mainModule": "other"}), ("type", "binary")]:
                broken = copy.deepcopy(SBOM)
                broken["artifacts"][index][field] = value
                with self.subTest(index=index, field=field), self.assertRaises(ValueError):
                    inv.inventory(broken, RUNTIME, IMAGE, expected_pins=PINS)
            broken = copy.deepcopy(SBOM)
            broken["artifacts"].pop(index)
            with self.assertRaises(ValueError):
                inv.inventory(broken, RUNTIME, IMAGE, expected_pins=PINS)
        broken = copy.deepcopy(SBOM)
        broken["artifacts"][2]["version"] = "UNKNOWN"
        with self.assertRaises(ValueError):
            inv.inventory(broken, RUNTIME, IMAGE, expected_pins=PINS)

    def test_rebuilt_lfs_source_revision_and_app_releases_must_match_image_pins(self):
        for revision in ("short", "b" * 40):
            runtime = dict(RUNTIME, git_lfs=RUNTIME["git_lfs"].replace("aece9221f8c09221a14395d964806b956289bc07", revision))
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                inv.inventory(SBOM, runtime, IMAGE, expected_pins=PINS)
        for runtime, version in (("gh", "2.103.0"), ("git_lfs", "3.8.0")):
            raw = dict(RUNTIME, **{runtime: RUNTIME[runtime].replace(version, "0.1.0")})
            sbom = copy.deepcopy(SBOM)
            sbom["artifacts"][2 if runtime == "gh" else 3]["version"] = "v0.1.0"
            with self.subTest(runtime=runtime), self.assertRaises(ValueError):
                inv.inventory(sbom, raw, IMAGE, expected_pins=PINS)

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
        findings = inv.grype_findings({"descriptor": {"name": "grype"}, "distro": {"name": "debian", "version": "12"}, "matches": matches}, SBOM)
        self.assertEqual(len(findings), 5)
        self.assertEqual(findings[0]["context"], "managed-image")
        self.assertEqual(findings[0]["package"], "binary:node")
        with self.assertRaises(ValueError):
            inv.grype_findings({}, SBOM)

    def test_go_symbols_never_create_a_local_advisory_ignore(self):
        sbom = copy.deepcopy(SBOM)
        crypto = {"id": "crypto", "name": "golang.org/x/crypto", "version": "v0.58.0",
                  "type": "go-module", "metadata": {"symbols": {
                      "golang.org/x/crypto/ssh": ["ParseAuthorizedKey"]}}}
        sbom["artifacts"].append(crypto)
        # Applicability belongs to the pinned Grype matcher. If it returns a
        # finding, NAC retains it even when symbol metadata names another package.
        report = {"descriptor": {"name": "grype"},
                  "distro": {"name": "debian", "version": "12"}, "matches": [{
                      "artifact": crypto, "vulnerability": {
                          "id": "GO-2026-5932", "severity": "Unknown", "fix": {"versions": []}}}]}
        findings = inv.grype_findings(report, sbom)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["advisory"], "GO-2026-5932")
        self.assertEqual(findings[0]["severity"], "Unknown")

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

    def test_missing_or_malformed_publication_receipt_cannot_fall_back(self):
        trusted = self.root / "trusted.json"
        trusted.write_text('{"schema_version":1,"exceptions":[]}')
        receipt = self.root / "publication-policy.json"
        for contents in (None, "not json"):
            if contents is not None:
                receipt.write_text(contents)
            with self.subTest(contents=contents), patch.object(scan, "command") as child:
                with self.assertRaises((ValueError, FileNotFoundError)):
                    scan.evaluate([], trusted, trusted, self.root, publication_policy=receipt,
                                  source_revision="a" * 40)
                child.assert_not_called()

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

    def test_scanner_or_database_error_never_writes_a_pass(self):
        for failure in ("scanner failed", "database unavailable", "database too old"):
            bundle = self.root / failure.replace(" ", "-")
            bundle.mkdir()
            runtime = dict(RUNTIME, nac="nac-web 0.1.0 (aaaaaaaaaaaa)")
            for name, value in [("sbom.syft.json", SBOM), ("runtime.json", runtime),
                                ("identity.json", {"image": IMAGE, "source_revision": "a" * 40,
                                                   "go_application_pins": PINS}), ("coverage.json", {})]:
                inv.write_json(bundle / name, value)
            scan.bundle_manifest(bundle, IMAGE)
            args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=bundle,
                                      output=bundle / "rescan", tool_cache=self.root, db_cache=self.root)
            with patch.object(scan, "install_tools", return_value=({}, {})), patch.object(
                    scan, "scan_sbom", side_effect=ValueError(failure)), patch.object(scan, "evaluate") as policy:
                self.assertEqual(scan.run(args), 2)
            policy.assert_not_called()
            self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")

    def test_runtime_network_failure_is_not_a_safe_empty_response(self):
        with patch.object(scan, "download", side_effect=OSError("network unavailable")):
            with self.assertRaisesRegex(OSError, "network unavailable"):
                scan.query_runtimes({"versions": {"go": "1.27.0", "uv": "0.12.1"}}, self.root)

    def test_go_toolchain_advisory_blocks_when_stdlib_is_clean(self):
        def response(url, limit, data):
            query = json.loads(data)
            if query["package"]["name"] == "toolchain":
                return json.dumps({"vulns": [{"id": "GO-2026-6601", "affected": [
                    {"package": {"name": "toolchain", "ecosystem": "Go"}}]}]}).encode()
            return b"{}"
        with patch.object(scan, "download", side_effect=response):
            findings = scan.query_runtimes({"versions": {"go": "1.27.0", "uv": "0.12.1", "gh": "2.103.0", "git_lfs": "3.8.0"}}, self.root)
        self.assertEqual([(f["package"], f["advisory"], f["severity"]) for f in findings],
                         [("Go:toolchain", "GO-2026-6601", "Unknown")])
        self.assertEqual(json.loads((self.root / "go-toolchain-advisories.json").read_text())["query"]["version"], "1.27.0")

    def test_rebuilt_lfs_advisory_blocks_despite_unknown_sbom_main_version(self):
        def response(url, limit, data):
            query = json.loads(data)
            if query["package"]["name"] == "github.com/git-lfs/git-lfs/v3":
                self.assertEqual(query["version"], "v3.8.0")
                return json.dumps({"vulns": [{"id": "GO-lfs-fixture", "affected": [
                    {"package": query["package"]}]}]}).encode()
            return b"{}"
        coverage = inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=PINS)
        with patch.object(scan, "download", side_effect=response):
            findings = scan.query_runtimes(coverage, self.root)
        self.assertEqual([(f["package"], f["severity"]) for f in findings],
                         [("Go:github.com/git-lfs/git-lfs/v3", "Unknown")])
        policy = self.root / "policy.json"
        policy.write_text('{"schema_version":1,"exceptions":[]}')
        self.assertEqual(scan.evaluate(findings, policy, policy, self.root)["blocking"], findings)

    def test_go_application_query_failure_never_reuses_other_clean_results(self):
        coverage = inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=PINS)
        for module in ("github.com/cli/cli/v2", "github.com/git-lfs/git-lfs/v3"):
            for failure in (OSError("application network failed"), b'{"error":"unavailable"}'):
                def response(url, limit, data):
                    if json.loads(data)["package"]["name"] == module:
                        if isinstance(failure, Exception):
                            raise failure
                        return failure
                    return b"{}"
                with self.subTest(module=module, failure=failure), patch.object(scan, "download", side_effect=response):
                    with self.assertRaises((OSError, ValueError)):
                        scan.query_runtimes(coverage, self.root)

    def test_toolchain_query_failure_cannot_reuse_clean_stdlib_result(self):
        for failure in (OSError("toolchain network failed"), b'{"error":"unavailable"}'):
            def response(url, limit, data):
                if json.loads(data)["package"]["name"] == "toolchain":
                    if isinstance(failure, Exception):
                        raise failure
                    return failure
                return b"{}"
            with self.subTest(failure=failure), patch.object(scan, "download", side_effect=response):
                with self.assertRaises((OSError, ValueError)):
                    scan.query_runtimes({"versions": {"go": "1.27.0", "uv": "0.12.1"}}, self.root)

    def test_new_fixture_advisory_is_reported_without_replacing_candidate_policy(self):
        control = {("Go:toolchain", "GO-2026-6601")}
        new = {"package": "Go:toolchain", "advisory": "GO-future", "severity": "Unknown"}
        self.assertEqual(qualification.qualify_controls("safe", [new], control)["other_advisories"], 1)
        known = dict(new, advisory="GO-2026-6601")
        with self.assertRaises(ValueError):
            qualification.qualify_controls("safe", [known], control)
        with self.assertRaises(ValueError):
            qualification.qualify_controls("vulnerable", [new], control)
        self.assertEqual(qualification.qualify_controls("vulnerable", [known], control)["control_matches"], 1)

    def test_daily_selection_rejects_pr_expired_and_foreign_evidence(self):
        run = {"id": 12, "event": "push", "head_branch": "dev", "status": "completed",
               "conclusion": "success", "path": rescan.PRODUCER, "head_sha": "a" * 40, "created_at": "2026-10-21T06:00:00Z",
               "head_repository": {"full_name": "arcee-ai/nac"}}
        artifact = {"name": "managed-image-security-" + "a" * 40, "expired": False}
        jobs = {12: [{"name": rescan.INVENTORY_JOB, "status": "completed", "conclusion": "failure",
                      "steps": [{"name": rescan.INVENTORY_STEP, "status": "completed", "conclusion": "success"}]}]}
        self.assertEqual(rescan.select_run([run], {12: [artifact]}, jobs, NOW)[0], run)
        # Neither a red security verdict nor unrelated workflow failure hides the inventory.
        self.assertEqual(rescan.select_run([dict(run, conclusion="failure")], {12: [artifact]}, jobs, NOW)[0]["id"], 12)
        self.assertEqual(rescan.select_run([dict(run, status="in_progress")], {12: [artifact]}, jobs, NOW)[0]["id"], 12)
        for outcome in ("failure", "skipped", "cancelled", None):
            bad_jobs = {12: [dict(jobs[12][0], steps=[{"name": rescan.INVENTORY_STEP,
                                                   "status": "completed", "conclusion": outcome}])]}
            with self.assertRaises(ValueError):
                rescan.select_run([run], {12: [artifact]}, bad_jobs, NOW)
        with self.assertRaises(ValueError):
            rescan.select_run([run], {12: [artifact]}, {}, NOW)
        for replacement in ({"event": "pull_request"}, {"event": "workflow_dispatch"},
                            {"path": ".github/workflows/managed-image.yml"},
                            {"head_branch": "other"},
                            {"created_at": "2026-10-01T00:00:00Z"},
                            {"head_repository": {"full_name": "fork/nac"}}):
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                rescan.select_run([dict(run, **replacement)], {12: [artifact]}, jobs, NOW)
        with self.assertRaises(ValueError):
            rescan.select_run([run], {12: [dict(artifact, expired=True)]}, jobs, NOW)

    def test_latest_red_inventory_cannot_fall_back_to_older_green(self):
        newest = {"id": 2, "event": "push", "head_branch": "dev", "path": rescan.PRODUCER,
                  "conclusion": "failure", "created_at": "2026-10-21T08:00:00Z", "head_sha": "a" * 40,
                  "head_repository": {"full_name": "arcee-ai/nac"}}
        old = dict(newest, id=1, conclusion="success", head_sha="b" * 40)
        job = {"name": rescan.INVENTORY_JOB, "status": "completed", "conclusion": "failure", "steps": [
            {"name": rescan.INVENTORY_STEP, "status": "completed", "conclusion": "success"}]}
        jobs = {2: [job], 1: [dict(job, conclusion="success")]}
        artifacts = {2: [{"name": "managed-image-security-" + "a" * 40, "expired": False}],
                     1: [{"name": "managed-image-security-" + "b" * 40, "expired": False}]}
        self.assertEqual(rescan.select_run([newest, old], artifacts, jobs, NOW)[0]["id"], 2)
        for invalid in ([], [dict(artifacts[2][0], expired=True)]):
            with self.assertRaises(ValueError):
                rescan.select_run([newest, old], dict(artifacts, **{}) | {2: invalid}, jobs, NOW)
        # A fresh evaluation of the selected image must still retain/block its advisory.
        findings = inv.osv_findings({"vulns": [{"id": "GO-2026-6601", "affected": [
            {"package": {"name": "toolchain", "ecosystem": "Go"}}]}]}, "toolchain", "Go", "1.27.0")
        self.assertEqual(findings[0]["severity"], "Unknown")

    def test_daily_selected_red_bundle_is_freshly_evaluated_and_corruption_cannot_fall_back(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        newest = {"id": 2, "event": "push", "head_branch": "dev", "path": rescan.PRODUCER,
                  "conclusion": "failure", "created_at": now, "head_sha": "a" * 40,
                  "head_repository": {"full_name": "arcee-ai/nac"}}
        job = {"name": rescan.INVENTORY_JOB, "status": "completed", "conclusion": "failure", "steps": [
            {"name": rescan.INVENTORY_STEP, "status": "completed", "conclusion": "success"}]}
        requests = []
        for corruption in (None, "missing", "tampered"):
            output = self.root / str(corruption)
            def api(argv):
                requests.append(argv)
                endpoint = str(argv[2])
                if argv[:3] == ["gh", "run", "download"]:
                    bundle = Path(argv[-1]) / "inventory"
                    bundle.mkdir(parents=True)
                    if corruption != "missing":
                        for name, value in [("sbom.syft.json", SBOM),
                                            ("runtime.json", dict(RUNTIME, nac="nac-web 0.1.0 (aaaaaaaaaaaa)")),
                                            ("identity.json", {"image": IMAGE, "source_revision": "a" * 40,
                                                               "go_application_pins": PINS}),
                                            ("coverage.json", {})]:
                            inv.write_json(bundle / name, value)
                        scan.bundle_manifest(bundle, IMAGE)
                        if corruption == "tampered":
                            (bundle / "runtime.json").write_text("{}")
                    return ""
                if "/jobs?" in endpoint:
                    return json.dumps({"jobs": [job]})
                if "/artifacts?" in endpoint:
                    return json.dumps({"artifacts": [{"name": "managed-image-security-" + "a" * 40,
                                                     "expired": False}]})
                return json.dumps({"workflow_runs": [newest, dict(newest, id=1, head_sha="b" * 40)]})
            def fresh_scan(argv):
                args = argparse.Namespace(image=IMAGE, source_revision="a" * 40,
                    bundle=output / "retained/inventory", output=output / "rescan",
                    tool_cache=self.root, db_cache=self.root,
                    trusted_policy=scan.ROOT / ".github/security/exceptions.json",
                    candidate_policy=scan.ROOT / ".github/security/exceptions.json")
                return SimpleNamespace(returncode=scan.run(args))
            report = {"descriptor": {"name": "grype"}, "distro": {"name": "debian", "version": "12"}, "matches": []}
            finding = {"package": "Go:toolchain", "advisory": "GO-2026-6601", "version": "1.27.0",
                       "severity": "Unknown", "context": "managed-image"}
            with patch.object(rescan, "command", side_effect=api), patch.object(
                    rescan, "subprocess", SimpleNamespace(run=fresh_scan)), patch.object(
                    scan, "install_tools", return_value=({}, {})), patch.object(
                    scan, "scan_sbom", return_value=report) as scanner, patch.object(
                    scan, "query_runtimes", return_value=[finding]) as runtime:
                if corruption == "missing":
                    with self.assertRaises(FileNotFoundError):
                        rescan.rescan(output)
                else:
                    self.assertEqual(rescan.rescan(output), 1 if corruption is None else 2)
                if corruption is None:
                    scanner.assert_called_once()
                    runtime.assert_called_once()
                    self.assertEqual(json.loads((output / "rescan/result.json").read_text())["status"], "blocked")
                else:
                    scanner.assert_not_called()
            self.assertFalse(any("/runs/1/" in str(call) or call[:4] == ["gh", "run", "download", "1"]
                                 for call in requests))

    def test_inventory_success_is_not_a_security_or_publication_pass(self):
        inventory = self.root / "inventory"
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=None, inventory_only=True,
                                  output=inventory, tool_cache=self.root, db_cache=self.root)
        raw = dict(RUNTIME, nac="nac-web 0.1.0 (aaaaaaaaaaaa)")
        raw_sbom = copy.deepcopy(SBOM)
        raw_sbom["artifacts"][2]["metadata"]["symbols"] = {
            "github.com/cli/cli/v2/cmd/gh": ["main"]}
        def inventory_command(argv, *, output=None, **kwargs):
            if argv[:3] == ["docker", "image", "inspect"]:
                result = json.dumps([{"Id": IMAGE, "Architecture": "amd64", "Os": "linux"}])
            elif argv[:2] == ["docker", "run"]:
                result = json.dumps(raw)
            elif argv[0] == "syft":
                config = Path(argv[argv.index("--config") + 1]).read_text()
                self.assertIn("\ngolang:\n  capture-symbols: all\n", config)
                inv.write_json(inventory / "sbom.syft.json", raw_sbom)
                result = ""
            elif argv[:4] == ["git", "-C", scan.ROOT, "show"]:
                self.assertEqual(argv[4], "a" * 40 + ":docker/managed/Dockerfile")
                result = DOCKERFILE_PINS
            else:
                result = "unix:///fixture.sock"
            if output:
                output.write_text(result)
            return result
        with patch.object(scan, "command", side_effect=inventory_command), patch.object(
                scan, "install_tools", return_value=({"syft": "syft"}, {})), patch.object(scan, "scan_sbom") as advisory:
            self.assertEqual(scan.run(args), 0)
        advisory.assert_not_called()
        self.assertEqual(json.loads((inventory / "result.json").read_text())["status"], "inventoried")
        self.assertEqual(json.loads((inventory / "identity.json").read_text())["go_application_pins"], PINS)
        self.assertEqual(json.loads((inventory / "sbom.syft.json").read_text()), raw_sbom)
        publication_args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, output=inventory,
                                              trusted_policy=self.root / "policy", candidate_policy=self.root / "policy")
        with patch.object(publication, "command"), patch.object(publication.subprocess, "run") as child:
            child.return_value.returncode = 0
            with self.assertRaisesRegex(ValueError, "publication evidence mismatch"):
                publication.gate(publication_args)
        self.assertFalse((inventory / "publication-gate.json").exists())
        # Later scanner installation failure leaves the trusted raw inventory intact.
        args.bundle, args.inventory_only, args.output = inventory, False, self.root / "security"
        with patch.object(scan, "install_tools", side_effect=OSError("scanner unavailable")):
            self.assertEqual(scan.run(args), 2)
        self.assertTrue((inventory / "bundle.json").is_file())
        self.assertTrue((args.output / "bundle.json").is_file())
        self.assertEqual(json.loads((args.output / "sbom.syft.json").read_text()), raw_sbom)
        self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")

    def test_failed_security_prevents_publication_gate_receipt(self):
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40,
                                  trusted_policy=self.root / "trusted", candidate_policy=self.root / "candidate",
                                  publication_policy=self.root / "publication-policy.json",
                                  output=self.root / "evidence")
        with patch.object(publication, "command") as smoke, patch.object(publication.subprocess, "run") as security:
            security.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, "publication blocked"):
                publication.gate(args)
            self.assertEqual(smoke.call_args.kwargs["env"]["MANAGED_IMAGE"], IMAGE)
            self.assertEqual(smoke.call_args.kwargs["env"]["MANAGED_IMAGE_SKIP_BUILD"], "1")
            self.assertIn("--publication-policy", security.call_args.args[0])
            self.assertIn(str(args.publication_policy), security.call_args.args[0])
        self.assertFalse((args.output / "publication-gate.json").exists())

    def test_retained_image_pins_survive_checkout_upgrade_and_still_bind_actual_binary(self):
        bundle = self.root / "bundle"
        bundle.mkdir()
        identity = {"image": IMAGE, "source_revision": "a" * 40, "go_application_pins": PINS}
        for name, value in [("sbom.syft.json", SBOM), ("runtime.json", dict(RUNTIME, nac="nac-web 0.1.0 (aaaaaaaaaaaa)")),
                            ("identity.json", identity), ("coverage.json", {})]:
            inv.write_json(bundle / name, value)
        scan.bundle_manifest(bundle, IMAGE)
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=bundle,
                                  output=self.root / "rescan", tool_cache=self.root, db_cache=self.root,
                                  trusted_policy=self.root / "policy", candidate_policy=self.root / "policy")
        # A rescan must not read current checkout pins or require the old source
        # commit to exist in today's shallow checkout.
        upgraded = dict(PINS, GH_VERSION="3.0.0", GIT_LFS_VERSION="4.0.0", GIT_LFS_REVISION="b" * 40)
        with patch.object(inv, "managed_go_pins", return_value=upgraded), patch.object(
                scan, "managed_go_pins", side_effect=AssertionError("current checkout read")), patch.object(
                scan, "install_tools", return_value=({}, {})), patch.object(scan, "scan_sbom", return_value={}), patch.object(
                scan, "grype_findings", return_value=[]), patch.object(scan, "query_runtimes", return_value=[]), patch.object(
                scan, "evaluate", return_value={"blocking": [], "excepted": [], "reporting": []}):
            self.assertEqual(scan.run(args), 0)
        retained = json.loads((args.output / "identity.json").read_text())
        self.assertEqual(retained["go_application_pins"], PINS)
        with self.assertRaises(ValueError):
            inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=upgraded)
        for pins in (None, {}, dict(PINS, GIT_LFS_REVISION="short")):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                inv.inventory(SBOM, RUNTIME, IMAGE, expected_pins=pins)
        (bundle / "identity.json").write_text(json.dumps(dict(identity, go_application_pins=upgraded)))
        args.output = self.root / "tampered"
        self.assertEqual(scan.run(args), 2)

    def test_initial_inventory_cannot_fall_back_when_exact_source_pins_are_unavailable(self):
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=None, inventory_only=True,
                                  output=self.root / "initial", tool_cache=self.root, db_cache=self.root)
        def source_unavailable(argv, **kwargs):
            if argv[:3] == ["docker", "image", "inspect"]:
                return json.dumps([{"Id": IMAGE, "Architecture": "amd64", "Os": "linux"}])
            self.assertEqual(argv[:4], ["git", "-C", scan.ROOT, "show"])
            self.assertEqual(argv[4], "a" * 40 + ":docker/managed/Dockerfile")
            raise ValueError("exact source unavailable")
        with patch.object(scan, "command", side_effect=source_unavailable), patch.object(scan, "install_tools") as install:
            self.assertEqual(scan.run(args), 2)
        install.assert_not_called()
        self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")

    def test_legacy_bundle_without_source_pins_is_error_not_current_pin_fallback(self):
        bundle = self.root / "legacy"
        bundle.mkdir()
        for name, value in [("sbom.syft.json", SBOM), ("runtime.json", dict(RUNTIME, nac="nac-web 0.1.0 (aaaaaaaaaaaa)")),
                            ("identity.json", {"image": IMAGE, "source_revision": "a" * 40}), ("coverage.json", {})]:
            inv.write_json(bundle / name, value)
        scan.bundle_manifest(bundle, IMAGE)  # Valid old hashes, not tampered bytes.
        args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=bundle,
                                  output=self.root / "legacy-rescan", tool_cache=self.root, db_cache=self.root)
        with patch.object(scan, "managed_go_pins", side_effect=AssertionError("current pin fallback")), patch.object(
                scan, "query_runtimes") as query:
            self.assertEqual(scan.run(args), 2)
        query.assert_not_called()
        result = json.loads((args.output / "result.json").read_text())
        self.assertEqual(result["status"], "error")
        self.assertIn("missing/incomplete image-source", result["error"])

    def test_floating_input_fails_before_docker_or_network(self):
        args = argparse.Namespace(image="nac:latest", source_revision="a" * 40, output=self.root / "evidence")
        with patch.object(scan, "command") as command:
            self.assertEqual(scan.run(args), 2)
        command.assert_not_called()
        self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")


if __name__ == "__main__":
    unittest.main()
