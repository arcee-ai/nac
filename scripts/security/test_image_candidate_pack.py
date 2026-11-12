"""Observed Actions ZIP layout: 24 hashed V4 files plus six diagnostics."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from image_approval_intake import ApprovalError
import image_candidate_archive as archive
import image_candidate_pack as pack


IMAGE = "sha256:" + "a" * 64
SOURCE = "b" * 40
HASHED = (
    "applicability-consumers.json", "applicability-container-inspect.json",
    "applicability-context.json", "applicability-filesystem.json",
    "applicability-filesystem.tar", "applicability-image-inspect.json",
    "applicability-provenance.json", "applicability-source-curl.tar.xz",
    "applicability-source-krb5-autoconf.patch", "applicability-source-krb5-c23.patch",
    "applicability-source-krb5-negoex.patch", "applicability-source-krb5-ticket-info.patch",
    "applicability-source-krb5.tar.gz", "applicability-source-libssh2-debian.tar.xz",
    "applicability-source-libssh2-supplier-55200.patch",
    "applicability-source-libssh2-supplier-sftp.patch",
    "applicability-source-libssh2.tar.gz", "coverage.json", "identity.json",
    "runtime.json", "rust-distribution.json", "rust-distribution.toml",
    "rust-payload.json", "sbom.syft.json",
)
DIAGNOSTICS = ("result.json", "runtime.json.stderr", "syft.txt",
               "syft.txt.stderr", "syft.yaml", "tools.json")


class CandidatePackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        files = {}
        for name in HASHED:
            payload = (json.dumps({"image": IMAGE, "source_revision": SOURCE}).encode()
                       if name == "identity.json" else f"observed-format-{name}".encode())
            (self.source / name).write_bytes(payload)
            files[name] = hashlib.sha256(payload).hexdigest()
        (self.source / "bundle.json").write_text(json.dumps({
            "schema_version": 4, "image": IMAGE, "files": files,
        }))
        for name in DIAGNOSTICS:
            (self.source / name).write_text(f"diagnostic {name}\n")

    def stage(self):
        return pack.stage_inventory(self.source, self.root / "staged",
                                    image=IMAGE, source_revision=SOURCE)

    def test_observed_32_member_artifact_becomes_exact_26_member_candidate(self):
        staged = self.stage()
        self.assertEqual({p.name for p in staged.iterdir()}, {"bundle.json", *HASHED})
        self.assertFalse(any((staged / name).exists() for name in DIAGNOSTICS))
        # GitHub upload-artifact v4 writes regular ZIP file entries at this root.
        (self.root / "staged/image.tar").write_bytes(b"invented-image-archive")
        zipped = self.root / "candidate.zip"
        with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted((self.root / "staged").rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(self.root / "staged"))
        digest = "sha256:" + hashlib.sha256(zipped.read_bytes()).hexdigest()
        extracted, inventory = archive.extract_candidate(
            zipped, self.root / "extracted", artifact_digest=digest,
            image=IMAGE, source_revision=SOURCE)
        self.assertEqual(extracted.read_bytes(), b"invented-image-archive")
        self.assertEqual({p.name for p in inventory.iterdir()}, {"bundle.json", *HASHED})

    def test_changed_hash_missing_input_and_wrong_identity_fail_closed(self):
        (self.source / "sbom.syft.json").write_bytes(b"changed")
        with self.assertRaisesRegex(ApprovalError, "hash mismatch"):
            self.stage()
        (self.source / "sbom.syft.json").unlink()
        with self.assertRaises(OSError):
            pack.stage_inventory(self.source, self.root / "second",
                                 image=IMAGE, source_revision=SOURCE)
        for image, source in [("sha256:" + "c" * 64, SOURCE), (IMAGE, "d" * 40)]:
            with self.subTest(image=image, source=source), self.assertRaises(ApprovalError):
                pack.stage_inventory(self.source, self.root / f"wrong-{source[0]}-{image[7]}",
                                     image=image, source_revision=source)

    def test_path_escape_and_symlinked_hashed_input_fail_closed(self):
        manifest = json.loads((self.source / "bundle.json").read_text())
        manifest["files"]["../escape"] = "0" * 64
        (self.source / "bundle.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ApprovalError, "manifest is invalid"):
            self.stage()
        del manifest["files"]["../escape"]
        (self.source / "bundle.json").write_text(json.dumps(manifest))
        (self.source / "sbom.syft.json").unlink()
        (self.source / "sbom.syft.json").symlink_to(self.source / "runtime.json")
        with self.assertRaises(OSError):
            pack.stage_inventory(self.source, self.root / "linked",
                                 image=IMAGE, source_revision=SOURCE)

    def test_bounds_and_destination_are_mandatory(self):
        with patch.object(pack, "MAX_INVENTORY_BYTES", 64):
            with self.assertRaisesRegex(ApprovalError, "oversized"):
                self.stage()
        occupied = self.root / "occupied"
        occupied.mkdir()
        with self.assertRaisesRegex(ApprovalError, "already exists"):
            pack.stage_inventory(self.source, occupied,
                                 image=IMAGE, source_revision=SOURCE)


if __name__ == "__main__":
    unittest.main()
