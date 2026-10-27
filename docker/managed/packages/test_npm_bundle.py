#!/usr/bin/env python3
"""Archive admission negatives and binding of the pinned downstream npm graph."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import shutil
import stat
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("npm_bundle", ROOT / "correct-npm-bundle.py")
BUNDLE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUNDLE)


def archive(name, kind=tarfile.REGTYPE):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as tar:
        member = tarfile.TarInfo(name)
        member.type = kind
        member.linkname = "/tmp/escape"
        tar.addfile(member, io.BytesIO())
    return data.getvalue()


class NpmBundleTests(unittest.TestCase):
    def test_noncanonical_or_link_archive_rejected(self):
        for name, kind in [("package/../escape", tarfile.REGTYPE),
                           ("/package/escape", tarfile.REGTYPE),
                           ("other/file", tarfile.REGTYPE),
                           ("package/link", tarfile.SYMTYPE),
                           ("package/link", tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as d:
                with self.assertRaisesRegex(ValueError, "noncanonical"):
                    BUNDLE.unpack(archive(name, kind), Path(d))

    def test_ordinary_file_unpack(self):
        with tempfile.TemporaryDirectory() as d:
            BUNDLE.unpack(archive("package/LICENSE"), Path(d))
            self.assertTrue((Path(d) / "LICENSE").is_file())

    def test_copied_public_bundle_remains_readable_by_runtime_user(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "private-stage"
            root.mkdir(mode=0o700)
            old_umask = os.umask(0o077)
            try:
                BUNDLE.unpack(archive("package/lib/nested/module.js"), root)
                destination = Path(d) / "installed"
                shutil.copytree(root, destination)
            finally:
                os.umask(old_umask)
            for path in [destination, *destination.rglob("*")]:
                mode = stat.S_IMODE(path.stat().st_mode)
                self.assertEqual(mode & 0o444, 0o444, str(path))
                if path.is_dir():
                    self.assertEqual(mode & 0o111, 0o111, str(path))

    def test_parent_archive_and_same_major_patch_graph_binding(self):
        lock = json.loads((ROOT / "npm-bundle.lock.json").read_text())
        dockerfile = (ROOT.parent / "Dockerfile").read_text()
        self.assertIn("ARG NPM_VERSION=" + lock["parent"]["version"], dockerfile)
        self.assertIn("ARG NPM_SHA256=" + lock["parent"]["sha256"], dockerfile)
        self.assertEqual(set(lock["corrections"]), {"undici", "ip-address"})
        for name, spec in lock["corrections"].items():
            self.assertEqual(spec["from"].split(".")[0], spec["version"].split(".")[0])
            self.assertEqual(spec["url"], f"https://registry.npmjs.org/{name}/-/{name}-{spec['version']}.tgz")
            self.assertRegex(spec["sha256"], r"^[0-9a-f]{64}$")
            self.assertEqual(spec["license"], "MIT")


if __name__ == "__main__":
    unittest.main()
