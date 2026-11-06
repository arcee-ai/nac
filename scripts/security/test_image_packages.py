"""Passive package integrity controls, without invoking affected library behavior."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import image_inventory as inv
import image_packages as packages
import image_scan as scan
from test_image_security import IMAGE, PINS, RUNTIME, SBOM


def fixture():
    pins = {"schema_version": 1, "downloads": {
        "source.tar.gz": {"url": "https://example.invalid/source.tar.gz", "sha256": "a" * 64},
        "fix.patch": {"url": "https://example.invalid/fix.patch", "sha256": "b" * 64}}}
    versions = {"krb5": ("1.22.2", "1.22.2-r6"), "curl": ("8.23.0", "8.23.0-r2"),
                "sasl": ("2.1.28", "2.1.28-r59"), "gcc_headers": ("16.2.0", "16.2.0-r2"),
                "libssh2": ("1.11.1", "1.11.1-r12")}
    for owner, (version, revision) in versions.items():
        pins[owner] = {"version": version, "package_version": revision, "source_commit": "c" * 40,
                       "license": "MIT", "archive": "source.tar.gz", "patches": ["fix.patch"],
                       "upstream_name": owner}
    evidence = {"lock": copy.deepcopy(pins), "records": {}, "actual_payloads": {},
                "archive_hashes": {}, "archive_manifest": ""}
    artifacts = []
    for name, owner in packages.PACKAGE_OWNERS.items():
        spec = pins[owner]
        payload = {f"/usr/lib/{name}.so.1": {"sha256": "d" * 64}}
        evidence["records"][name] = {"schema_version": 1, "supplier": "NAC", "package": name,
            **copy.deepcopy(spec), "downloads": copy.deepcopy(pins["downloads"]), "installed_payload": payload}
        evidence["actual_payloads"][name] = copy.deepcopy(payload)
        archive = f"{name}-{spec['package_version']}.apk"
        evidence["archive_hashes"][archive] = "e" * 64
        evidence["archive_manifest"] += "e" * 64 + f"  ./{archive}\n"
        artifacts.append({"id": name, "type": "apk", "name": name, "version": spec["package_version"],
                          "metadata": {"package": name, "version": spec["package_version"],
                                       "originPackage": owner, "architecture": "x86_64"}})
    return pins, evidence, artifacts


class PackageIntegrityTests(unittest.TestCase):
    def test_source_pins_are_read_only_for_wolfi_from_requested_revision(self):
        pins, _, _ = fixture()
        read = unittest.mock.Mock(return_value=json.dumps(pins))
        self.assertIsNone(packages.source_package_pins("FROM debian:trixie", read))
        read.assert_not_called()
        self.assertEqual(packages.source_package_pins("FROM cgr.dev/chainguard/wolfi-base@sha256:abc", read), pins)
        read.assert_called_once_with(packages.LOCK_PATH)
        for broken in ({}, {**pins, "downloads": {}}, {k: v for k, v in pins.items() if k != "krb5"},
                       {k: v for k, v in pins.items() if k != "libssh2"}, {**pins, "unknown_owner": {}}):
            read.return_value = json.dumps(broken)
            with self.subTest(broken=broken.keys()), self.assertRaises(ValueError):
                packages.source_package_pins("FROM cgr.dev/chainguard/wolfi-base@sha256:abc", read)

    def test_correct_package_files_and_source_identity_pass_without_advisory_verdict(self):
        pins, evidence, artifacts = fixture()
        result = packages.package_integrity(evidence, pins, artifacts)
        self.assertEqual(set(result["packages"]), set(packages.PACKAGE_OWNERS))
        self.assertNotIn("security_verdict", result)
        self.assertNotIn("findings", result)

    def test_old_unqualified_package_and_missing_retained_pins_are_rejected(self):
        pins, evidence, artifacts = fixture()
        for value in (None, {}, {**evidence, "records": {}}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                packages.package_integrity(value, pins, artifacts)
        with self.assertRaisesRegex(ValueError, "retained"):
            packages.package_integrity(evidence, None, artifacts)
        old = copy.deepcopy(artifacts)
        old[0]["version"] = "1.22.2-r5"
        with self.assertRaisesRegex(ValueError, "SBOM"):
            packages.package_integrity(evidence, pins, old)

    def test_actual_installed_byte_change_cannot_reuse_valid_source_record(self):
        pins, evidence, artifacts = fixture()
        path = next(iter(evidence["actual_payloads"]["krb5-libs"]))
        for signature in ({"sha256": "f" * 64}, {"symlink": "old-library.so"}):
            broken = copy.deepcopy(evidence)
            broken["actual_payloads"]["krb5-libs"][path] = signature
            with self.subTest(signature=signature), self.assertRaisesRegex(ValueError, "bytes differ"):
                packages.package_integrity(broken, pins, artifacts)

    def test_libssh2_payload_and_package_cannot_be_omitted_or_replaced(self):
        pins, evidence, artifacts = fixture()
        broken = copy.deepcopy(evidence)
        broken["records"].pop("libssh2")
        with self.assertRaisesRegex(ValueError, "owned runtime package"):
            packages.package_integrity(broken, pins, artifacts)
        artifact = next(value for value in artifacts if value["name"] == "libssh2")
        artifact["version"] = "1.11.1-r11"
        with self.assertRaisesRegex(ValueError, "SBOM"):
            packages.package_integrity(evidence, pins, artifacts)

    def test_source_patch_supplier_archive_and_payload_metadata_cannot_drift(self):
        pins, evidence, artifacts = fixture()
        mutations = [lambda e: e["records"]["krb5-libs"].update(supplier="unrelated"),
                     lambda e: e["records"]["krb5-libs"].update(patches=[]),
                     lambda e: e["lock"]["downloads"]["fix.patch"].update(sha256="f" * 64),
                     lambda e: e["archive_hashes"].update({next(iter(e["archive_hashes"])): "f" * 64}),
                     lambda e: e.update(archive_manifest=e["archive_manifest"] + e["archive_manifest"]),
                     lambda e: e["records"]["krb5-libs"].update(installed_payload={})]
        for mutate in mutations:
            broken = copy.deepcopy(evidence)
            mutate(broken)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                packages.package_integrity(broken, pins, artifacts)
        for path in ("/usr/lib/../../etc/passwd", "/etc/passwd", "/usr//lib/file"):
            broken = copy.deepcopy(evidence)
            payload = {path: {"sha256": "d" * 64}}
            broken["records"]["krb5-libs"]["installed_payload"] = payload
            broken["actual_payloads"]["krb5-libs"] = payload
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "noncanonical"):
                packages.package_integrity(broken, pins, artifacts)

    def test_false_zero_report_cannot_bypass_missing_wolfi_provenance(self):
        # This deliberately has complete APK/Go/Node inventories but no owned
        # source/build evidence. No vulnerable-library invocation is needed.
        pins, _, artifacts = fixture()
        sbom = copy.deepcopy(SBOM)
        sbom["distro"] = {"id": "wolfi", "versionID": "20230201"}
        sbom["artifacts"] = artifacts + sbom["artifacts"][1:]
        runtime = {**RUNTIME, "nac": "nac-web 0.1.0 (aaaaaaaaaaaa)",
                   "os_release": 'ID=wolfi\nVERSION_ID="20230201"\n',
                   "apk": "\n".join("\t".join([p["name"], p["version"],
                       p["metadata"]["originPackage"], "x86_64"]) for p in artifacts)}
        del runtime["dpkg"]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, value in [("sbom.syft.json", sbom), ("runtime.json", runtime),
                ("identity.json", {"image": IMAGE, "source_revision": "a" * 40,
                    "go_application_pins": PINS, "runtime_package_pins": pins}), ("coverage.json", {})]:
                inv.write_json(root / name, value)
            scan.bundle_manifest(root, IMAGE)
            args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=root,
                                      output=root / "result", tool_cache=root, db_cache=root)
            with patch.object(scan, "install_tools", return_value=({}, {})), patch.object(
                scan, "scan_sbom", return_value={"matches": []}) as scanner, patch.object(scan, "evaluate") as policy:
                self.assertEqual(scan.run(args), 2)
            scanner.assert_not_called()
            policy.assert_not_called()
            self.assertEqual(json.loads((args.output / "result.json").read_text())["status"], "error")

    def test_retained_integrity_uses_original_pins_and_never_clears_a_scanner_match(self):
        pins, evidence, artifacts = fixture()
        sbom = copy.deepcopy(SBOM)
        sbom["distro"] = {"id": "wolfi", "versionID": "20230201"}
        sbom["artifacts"] = artifacts + sbom["artifacts"][1:]
        runtime = {**RUNTIME, "nac": "nac-web 0.1.0 (aaaaaaaaaaaa)",
                   "os_release": 'ID=wolfi\nVERSION_ID="20230201"\n', "owned_packages": evidence,
                   "apk": "\n".join("\t".join([p["name"], p["version"],
                       p["metadata"]["originPackage"], "x86_64"]) for p in artifacts)}
        del runtime["dpkg"]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, value in [("sbom.syft.json", sbom), ("runtime.json", runtime),
                ("identity.json", {"image": IMAGE, "source_revision": "a" * 40,
                    "go_application_pins": PINS, "runtime_package_pins": pins}), ("coverage.json", {})]:
                inv.write_json(root / name, value)
            scan.bundle_manifest(root, IMAGE)
            policy = root / "policy.json"
            policy.write_text('{"schema_version":1,"exceptions":[]}')
            upstream_match = {"advisory": "CVE-upstream-control", "package": "upstream:mit/kerberos_5",
                "context": "managed-image", "version": "1.22.2", "severity": "High",
                "source": "grype-upstream", "fixed": []}
            for index, (matches, extra, expected) in enumerate((([], [], 0), ([{"artifact": artifacts[0],
                "vulnerability": {"id": "CVE-retained-control", "severity": "High", "fix": {"versions": []}}}], [], 1),
                ([], [upstream_match], 1))):
                args = argparse.Namespace(image=IMAGE, source_revision="a" * 40, bundle=root,
                    output=root / f"scan-{index}", tool_cache=root, db_cache=root,
                    trusted_policy=policy, candidate_policy=policy)
                report = {"descriptor": {"name": "grype"}, "distro": {"name": "wolfi", "version": "20230201"},
                          "matches": matches}
                with patch.object(scan, "install_tools", return_value=({}, {})), patch.object(
                    scan, "scan_sbom", return_value=report), patch.object(scan, "query_runtimes", return_value=[]), patch.object(
                    scan, "scan_owned_upstreams", return_value=extra), patch.object(
                    scan, "command", wraps=scan.command) as child:
                    self.assertEqual(scan.run(args), expected)
                self.assertTrue(all(str(call.args[0][0]) != "git" for call in child.call_args_list))
                self.assertEqual(json.loads((args.output / "result.json").read_text())["blocking"], expected)
                if matches:
                    self.assertEqual(json.loads((args.output / "findings.json").read_text())[0]["advisory"],
                                     "CVE-retained-control")
                if extra:
                    self.assertEqual(json.loads((args.output / "findings.json").read_text()), extra)


if __name__ == "__main__":
    unittest.main()
