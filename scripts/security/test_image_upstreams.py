"""Advisory search controls; no vulnerable library is executed."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import image_scan as scan
import image_upstreams as upstream
from image_packages import package_integrity
from test_image_packages import fixture


def coverage():
    pins, evidence, artifacts = fixture()
    return {"os_release": {"ID": "wolfi"},
            "owned_runtime_packages": package_integrity(evidence, pins, artifacts)}


def report(targets, *, wolfi=False, advisory="CVE-control", severity="High"):
    identity = next(iter(targets.values()))
    if wolfi:
        name, version = identity.split("/")[-1].split("?", 1)[0].split("@")
        artifact = {"name": name, "version": version, "purl": identity, "type": "apk"}
    else:
        parts = identity.split(":")
        artifact = {"name": parts[4], "version": parts[5], "cpes": [identity]}
    return {"descriptor": {"name": "grype"}, "distro": {
        "name": "wolfi" if wolfi else "", "version": "20230201" if wolfi else ""},
        "matches": [{"artifact": artifact, "vulnerability": {
            "id": advisory, "severity": severity, "fix": {"versions": []}}}]}


class UpstreamTests(unittest.TestCase):
    def test_canonical_inputs_use_verified_upstream_versions_not_local_revisions(self):
        original = coverage()
        targets = upstream.upstream_targets(original)
        self.assertEqual(targets, {
            "krb5": "cpe:2.3:a:mit:kerberos_5:1.22.2:*:*:*:*:*:*:*",
            "curl": "cpe:2.3:a:haxx:curl:8.23.0:*:*:*:*:*:*:*",
            "sasl": "cpe:2.3:a:cyrusimap:cyrus-sasl:2.1.28:*:*:*:*:*:*:*",
            "gcc_headers": "cpe:2.3:a:gnu:gcc:16.2.0:*:*:*:*:*:*:*",
            "libssh2": "cpe:2.3:a:libssh2:libssh2:1.11.1:*:*:*:*:*:*:*"})
        for value in original["owned_runtime_packages"]["packages"].values():
            value["package_version"] = value["version"] + "-r999999"
        self.assertEqual(upstream.upstream_targets(original), targets)
        self.assertEqual(upstream.wolfi_upstream_targets(targets)["curl"],
                         "pkg:apk/wolfi/curl@8.23.0?distro=wolfi-20230201")
        self.assertEqual(upstream.wolfi_upstream_targets(targets)["libssh2"],
                         "pkg:apk/wolfi/libssh2@1.11.1?distro=wolfi-20230201")

    def test_libssh2_conservative_high_and_unknown_findings_are_retained(self):
        targets = {"libssh2": upstream.upstream_targets(coverage())["libssh2"]}
        for wolfi in (False, True):
            inputs = upstream.wolfi_upstream_targets(targets) if wolfi else targets
            for severity in ("High", "Unknown"):
                findings = upstream.upstream_findings(report(inputs, wolfi=wolfi, severity=severity), inputs, wolfi=wolfi)
                self.assertEqual(findings[0]["severity"], severity)
                self.assertEqual(findings[0]["version"], "1.11.1")
                self.assertEqual(findings[0]["fixed"], [])

    def test_missing_unknown_or_split_identity_fails_even_with_empty_scan(self):
        mutations = [lambda x: x.pop("owned_runtime_packages"),
                     lambda x: x["owned_runtime_packages"]["packages"].pop("krb5-libs"),
                     lambda x: x["owned_runtime_packages"]["packages"].update(unrecognized={}),
                     lambda x: x["owned_runtime_packages"]["packages"]["curl"].update(version="8.23.0-r999"),
                     lambda x: x["owned_runtime_packages"]["packages"]["curl"].update(version=""),
                     lambda x: x["owned_runtime_packages"]["packages"]["curl"].update(version="8.22.0")]
        for mutate in mutations:
            value = coverage()
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                upstream.upstream_targets(value)
        self.assertEqual(upstream.upstream_targets({"os_release": {"ID": "debian"}}), {})

    def test_all_cpe_and_wolfi_findings_survive_including_unknown_severity(self):
        for wolfi in (False, True):
            targets = upstream.upstream_targets(coverage())
            if wolfi:
                targets = upstream.wolfi_upstream_targets(targets)
            value = report(targets, wolfi=wolfi)
            value["matches"].append(copy.deepcopy(value["matches"][0]))
            value["matches"][1]["vulnerability"].update(id="GHSA-control", severity="Unknown")
            result = upstream.upstream_findings(value, targets, wolfi=wolfi)
            self.assertEqual([(f["advisory"], f["severity"]) for f in result],
                             [("CVE-control", "High"), ("GHSA-control", "Unknown")])
            value["matches"] = []
            self.assertEqual(upstream.upstream_findings(value, targets, wolfi=wolfi), [])

    def test_unrequested_or_malformed_scanner_identities_fail_closed(self):
        targets = upstream.upstream_targets(coverage())
        for change in (lambda x: x.update(matches=None),
                       lambda x: x["descriptor"].update(name="other"),
                       lambda x: x["distro"].update(name="wolfi"),
                       lambda x: x["matches"][0]["artifact"].update(version="1.22.3"),
                       lambda x: x["matches"][0]["artifact"].update(cpes=["cpe:wrong"]),
                       lambda x: x["matches"][0]["vulnerability"].update(severity="unrecognized")):
            value = report(targets)
            change(value)
            with self.subTest(change=change), self.assertRaises(ValueError):
                upstream.upstream_findings(value, targets)

    def test_driver_runs_both_full_searches_and_rejects_changed_db_source_or_failure(self):
        for failure in (None, "db", "source", "tool"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                baseline = {"sha256": "a" * 64, "schema": "v6", "built": "2026-10-22T00:00:00Z"}
                (root / "db-evidence.json").write_text(json.dumps(baseline))
                seen = []

                def scanner(tools, path, output, env, *, target, prefix):
                    if failure == "tool":
                        raise ValueError("scanner unavailable")
                    seen.append((target, path.read_text().splitlines()))
                    actual = dict(baseline)
                    if failure == "db":
                        actual["sha256"] = "b" * 64
                    (root / f"{prefix}db-evidence.json").write_text(json.dumps(actual))
                    targets = upstream.upstream_targets(coverage())
                    wolfi = target.startswith("purl:")
                    if wolfi:
                        targets = upstream.wolfi_upstream_targets(targets)
                    result = report(targets, wolfi=wolfi)
                    result["source"] = {"type": "sbom-file", "target": str(path.resolve())}
                    if failure == "source":
                        result["source"]["target"] = "/wrong/inputs"
                    return result

                with patch.object(scan, "scan_sbom", side_effect=scanner):
                    if failure:
                        with self.assertRaises(ValueError):
                            scan.scan_owned_upstreams({}, coverage(), root, {})
                    else:
                        result = scan.scan_owned_upstreams({}, coverage(), root, {})
                        self.assertEqual(len(result), 2)
                        self.assertEqual(len(seen), 2)
                        self.assertTrue(seen[0][0].startswith("cpes:"))
                        self.assertTrue(seen[1][0].startswith("purl:"))
                        self.assertEqual([len(value[1]) for value in seen], [5, 5])


if __name__ == "__main__":
    unittest.main()
