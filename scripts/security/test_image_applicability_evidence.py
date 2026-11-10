"""Synthetic passive controls; none exercises or clears an advisory."""
import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

import image_applicability_evidence as evidence

IMAGE, SOURCE = "sha256:" + "a" * 64, "b" * 40


def elf(needed="libkrb5.so.3"):
    value = bytearray(512)
    value[:7] = b"\x7fELF\x02\x01\x01"
    struct.pack_into("<HH", value, 16, 3, 62)
    struct.pack_into("<Q", value, 32, 64)
    struct.pack_into("<HH", value, 54, 56, 2)
    struct.pack_into("<IIQQQQQQ", value, 64, 1, 4, 0, 0x400000, 0, 512, 512, 0x1000)
    struct.pack_into("<IIQQQQQQ", value, 120, 2, 4, 192, 0x4000c0, 0, 64, 64, 8)
    strings = b"\0" + needed.encode() + b"\0"
    struct.pack_into("<qQqQqQqQ", value, 192, 5, 0x400100, 10, len(strings), 1, 1, 0, 0)
    value[256:256 + len(strings)] = strings
    return bytes(value)


def archive(path, files, links=None, hardlinks=None, extra=None):
    links, hardlinks = links or {}, hardlinks or {}
    parents = set()
    for name in [*files, *links, *hardlinks]:
        parents.update(str(parent) for parent in Path(name).parents if str(parent) != ".")
    with tarfile.open(path, "w", format=tarfile.USTAR_FORMAT) as bundle:
        for name in sorted(parents, key=lambda name: (name.count("/"), name)):
            info = tarfile.TarInfo(name)
            info.type, info.mode = tarfile.DIRTYPE, 0o755
            bundle.addfile(info)
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o755 if name.startswith("usr/bin/") else 0o644
            bundle.addfile(info, io.BytesIO(data))
        for values, kind in [(links, tarfile.SYMTYPE), (hardlinks, tarfile.LNKTYPE)]:
            for name, target in values.items():
                info = tarfile.TarInfo(name)
                info.type, info.linkname, info.mode = kind, target, 0o777
                bundle.addfile(info)
        if extra:
            extra(bundle)


class ApplicabilityEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / "filesystem.tar"
        self.pins = {"schema_version": 1, "downloads": {}}
        self.downloads, self.files = {}, {}
        for owner in ("krb5", "curl"):
            names = [owner + ".tar.gz", owner + ".patch"]
            for name in names:
                data = ("reviewed fixture " + name).encode()
                path = self.root / name
                path.write_bytes(data)
                self.downloads[name] = path
                self.pins["downloads"][name] = {"url": "https://example.invalid/" + name,
                                                   "sha256": hashlib.sha256(data).hexdigest()}
            self.pins[owner] = {"version": "1.2.3", "package_version": "1.2.3-r6", "source_commit": "c" * 40,
                                "archive": names[0], "patches": [names[1]], "license": "MIT", "upstream_name": owner}
        for package, owner in evidence.PACKAGES.items():
            name = "usr/lib/" + package + ".so.1"
            data = elf()
            self.files[name] = data
            record = {"schema_version": 1, "supplier": "NAC", "package": package, **self.pins[owner],
                      "downloads": self.pins["downloads"],
                      "installed_payload": {"/" + name: {"sha256": hashlib.sha256(data).hexdigest()}}}
            self.files["usr/share/nac/package-provenance/" + package + ".json"] = evidence.canonical_json(record)
        self.files["usr/share/nac/runtime-package-build/sources.lock.json"] = evidence.canonical_json(self.pins)
        self.files["usr/bin/runner"] = b"#!/usr/bin/python3\nprint('benign fixture')\n"
        self.inspected = [{"Id": IMAGE, "Os": "linux", "Architecture": "amd64",
                           "Config": {"Labels": {"org.opencontainers.image.revision": SOURCE}}}]
        self.kwargs = {"image": IMAGE, "source_revision": SOURCE, "inspected": self.inspected,
                       "pins": self.pins, "downloads": self.downloads}
        archive(self.archive, self.files)

    def collect(self):
        return evidence.collect_evidence(self.archive, **self.kwargs)

    def test_complete_profile_binds_exact_sources_patches_payload_and_consumers(self):
        result = self.collect()
        provenance = evidence.validate_evidence(result, self.archive, **self.kwargs)
        self.assertEqual(provenance["subject"]["platform"], "linux/amd64")
        self.assertEqual(set(provenance["packages"]), set(evidence.PACKAGES))
        self.assertEqual(result["consumers"]["entries"]["/usr/lib/krb5-libs.so.1"]["needed"], ["libkrb5.so.3"])
        self.assertEqual(result["consumers"]["entries"]["/usr/bin/runner"]["kind"], "script")
        self.assertEqual(result["consumers"]["named_applications"], {"ftpd": [], "sudo": []})
        self.assertIn("Named-path absence", provenance["limitations"][0])
        self.assertNotIn("verdict", provenance)
        self.assertNotIn("findings", provenance)

    def test_source_or_patch_tamper_is_rejected(self):
        for name, path in self.downloads.items():
            original = path.read_bytes()
            path.write_bytes(b"tampered")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "source archive/patch"):
                self.collect()
            path.write_bytes(original)

    def test_installed_payload_tamper_is_rejected(self):
        self.files["usr/lib/krb5-libs.so.1"] = b"changed installed bytes"
        archive(self.archive, self.files)
        with self.assertRaisesRegex(ValueError, "payload differs"):
            self.collect()

    def test_source_lock_and_provenance_tamper_are_rejected(self):
        for name in ["usr/share/nac/runtime-package-build/sources.lock.json",
                     "usr/share/nac/package-provenance/curl.json"]:
            original = self.files[name]
            self.files[name] = b"{}"
            archive(self.archive, self.files)
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.collect()
            self.files[name] = original

    def test_missing_source_patch_or_metadata_is_rejected(self):
        missing = self.downloads.pop("curl.patch")
        with self.assertRaisesRegex(ValueError, "missing/unknown"):
            self.collect()
        self.downloads["curl.patch"] = missing
        self.files.pop("usr/share/nac/package-provenance/krb5-libs.json")
        archive(self.archive, self.files)
        with self.assertRaisesRegex(ValueError, "provenance mismatch"):
            self.collect()

    def test_wrong_image_source_platform_or_volumes_are_rejected(self):
        for change in [{"Id": "sha256:" + "d" * 64}, {"Architecture": "arm64"}, {"Os": "windows"},
                       {"Config": {"Labels": {"org.opencontainers.image.revision": "e" * 40}}},
                       {"Config": {**self.inspected[0]["Config"], "Volumes": {"/hidden": {}}}}]:
            broken = {**self.inspected[0], **change}
            with self.subTest(change=change), self.assertRaises(ValueError):
                evidence.collect_evidence(self.archive, **{**self.kwargs, "inspected": [broken]})
        with self.assertRaises(ValueError):
            evidence.collect_evidence(self.archive, **{**self.kwargs, "image": "mutable:tag"})

    def test_introduced_named_application_changes_bound_profile(self):
        original = self.collect()
        for name in ("sudo", "ftpd", "in.ftpd", "sudoedit"):
            self.files["usr/bin/" + name] = elf()
            archive(self.archive, self.files)
            current = self.collect()
            self.assertNotEqual(current["provenance"]["application_profile_sha256"],
                                original["provenance"]["application_profile_sha256"])
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "changed/incomplete"):
                evidence.validate_evidence(original, self.archive, **self.kwargs)
            self.files.pop("usr/bin/" + name)

    def test_introduced_renamed_or_opaque_consumer_changes_profile_without_absence_claim(self):
        original = self.collect()
        for data in (elf("libgssapi_krb5.so.2"), b"opaque statically linked candidate"):
            self.files["usr/bin/renamed-program"] = data
            archive(self.archive, self.files)
            current = self.collect()
            self.assertEqual(current["consumers"]["named_applications"], {"ftpd": [], "sudo": []})
            self.assertNotEqual(current["provenance"]["application_profile_sha256"],
                                original["provenance"]["application_profile_sha256"])
            self.assertIn("/usr/bin/renamed-program", current["consumers"]["entries"])

    def test_safe_links_and_hardlinks_are_retained_and_named_links_visible(self):
        archive(self.archive, self.files, links={"usr/bin/sudo": "../lib/krb5-libs.so.1"},
                hardlinks={"usr/bin/ftpd": "usr/lib/curl.so.1"})
        result = self.collect()
        self.assertEqual(result["consumers"]["named_applications"]["sudo"], ["/usr/bin/sudo"])
        self.assertEqual(result["consumers"]["named_applications"]["ftpd"], ["/usr/bin/ftpd"])
        self.assertEqual(result["consumers"]["entries"]["/usr/bin/ftpd"]["kind"], "elf")

    def test_owned_payload_symlink_chain_escape_is_rejected(self):
        name = "usr/share/nac/package-provenance/curl.json"
        record = json.loads(self.files[name])
        record["installed_payload"] = {"/usr/lib/curl-link": {"symlink": "curl-intermediate"}}
        self.files[name] = evidence.canonical_json(record)
        archive(self.archive, self.files, links={"usr/lib/curl-link": "curl-intermediate",
                                                "usr/lib/curl-intermediate": "/etc/passwd"})
        with self.assertRaisesRegex(ValueError, "chain escapes"):
            self.collect()

    def test_truncated_and_hidden_tail_exports_are_rejected(self):
        original = self.archive.read_bytes()
        for data in (original[:800], original[:-1024] + b"nonzero" + bytes(1017),
                     original + b"hidden payload" + bytes(2034)):
            self.archive.write_bytes(data)
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                self.collect()

    def test_unsafe_duplicate_missing_parent_and_unknown_entry_are_rejected(self):
        def extra(name, kind=tarfile.REGTYPE):
            def append(bundle):
                info = tarfile.TarInfo(name)
                info.type = kind
                bundle.addfile(info)
            return append
        for append in [extra("../escape"), extra("/absolute"), extra("usr/bin/runner"),
                       extra("missing/parent/file"), extra("unknown", b"Z")]:
            archive(self.archive, self.files, extra=append)
            with self.subTest(append=append), self.assertRaises(ValueError):
                self.collect()

    def test_malformed_elf_fails_closed_instead_of_dropping_consumer(self):
        for data in (b"\x7fELF", elf()[:100], elf().replace(b"\x7fELF\x02", b"\x7fELF\x01", 1)):
            self.files["usr/bin/candidate"] = data
            archive(self.archive, self.files)
            with self.subTest(length=len(data)), self.assertRaises(ValueError):
                self.collect()

    def test_mutated_or_missing_evidence_never_validates(self):
        result = self.collect()
        for broken in ({}, {**result, "consumers": {}}, {**result, "provenance": {}},
                       {**result, "filesystem": {**result["filesystem"], "entries": {}}}):
            with self.subTest(keys=broken.keys()), self.assertRaises(ValueError):
                evidence.validate_evidence(broken, self.archive, **self.kwargs)


if __name__ == "__main__":
    unittest.main()
