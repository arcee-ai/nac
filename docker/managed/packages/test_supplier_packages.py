#!/usr/bin/env python3
"""Characterize supplier-drift rejection before any owned package installation."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("supplier_check", ROOT / "check-supplier-packages.py")
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)
LOCK = json.loads((ROOT / "sources.lock.json").read_text())
# Actual predecessor versions from the reviewed stock Wolfi runtime profile.
PREDECESSORS = {"krb5-libs": "1.22.2-r5", "curl": "8.23.0-r1",
                "libcurl-openssl4": "8.23.0-r1", "cyrus-sasl-heimdal-libs": "2.1.28-r58",
                "gcc": "16.2.0-r1", "libgcc": "16.2.0-r1", "libstdc++": "16.2.0-r1",
                "libstdc++-dev": "16.2.0-r1", "libssh2": "1.11.1-r11"}
DATABASE = "\n\n".join(f"P:{name}\nV:{version}\nA:x86_64" for name, version in PREDECESSORS.items())


class SupplierAdmissionTests(unittest.TestCase):
    def test_reviewed_baseline_and_unrelated_packages(self):
        receipt = CHECK.verify_predecessors(LOCK, DATABASE + "\n\nP:unrelated\nV:9-r0\nA:noarch")
        self.assertEqual(receipt["packages"], PREDECESSORS)
        self.assertEqual(len(receipt["database_sha256"]), 64)

    def test_any_version_drift_or_missing_predecessor_fails(self):
        for name, version in PREDECESSORS.items():
            for replacement in [f"P:{name}\nV:99-r0", "P:other\nV:1-r0"]:
                with self.subTest(package=name, replacement=replacement):
                    with self.assertRaisesRegex(ValueError, "supplier predecessor differs"):
                        CHECK.verify_predecessors(LOCK, DATABASE.replace(f"P:{name}\nV:{version}", replacement))

    def test_owned_version_already_installed_fails(self):
        with self.assertRaisesRegex(ValueError, "supplier predecessor differs"):
            CHECK.verify_predecessors(LOCK, DATABASE.replace("V:1.22.2-r5", "V:1.22.2-r6"))

    def test_ambiguous_or_incomplete_database_fails(self):
        for extra in ["\n\nP:gcc\nV:16.2.0-r1", "\n\nP:broken", "\n\nP:x\nV:1\nV:2"]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                CHECK.verify_predecessors(LOCK, DATABASE + extra)

    def test_missing_or_conflicting_source_inventory_fails(self):
        for broken in [None, {}, {"gcc": "different"}]:
            lock = copy.deepcopy(LOCK)
            lock["krb5"]["supplier_packages"] = broken
            with self.subTest(inventory=broken), self.assertRaises(ValueError):
                CHECK.verify_predecessors(lock, DATABASE)

    def test_gate_precedes_owned_admission(self):
        dockerfile = (ROOT.parent / "Dockerfile").read_text()
        self.assertLess(dockerfile.index("python3 check-supplier-packages.py sources.lock.json"),
                        dockerfile.index("apk --no-network --repositories-file /dev/null add"))


if __name__ == "__main__":
    unittest.main()
