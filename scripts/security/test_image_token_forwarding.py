"""Inert child processes prove job-token inheritance without scanners or images."""
import datetime as dt
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import image_rescan as rescan
import image_scan as scan


class TokenForwardingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.environment = patch.dict(os.environ, {
            "GITHUB_TOKEN": "ghs_SYNTHETIC_JOB_TOKEN", "GH_TOKEN": "ghs_SYNTHETIC_GH_TOKEN"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_grype_api_child_inherits_job_token_before_checksum_admission(self):
        helper = self.root / ".github/scripts/github_asset.py"
        helper.parent.mkdir(parents=True)
        helper.write_text('''import os, pathlib, sys
assert os.environ["GITHUB_TOKEN"] == "ghs_SYNTHETIC_JOB_TOKEN"
assert os.environ["GH_TOKEN"] == "ghs_SYNTHETIC_GH_TOKEN"
pathlib.Path(sys.argv[sys.argv.index("--output") + 1]).write_bytes(b"inherited")
''')
        cache = self.root / "cache"
        with patch.object(scan, "ROOT", self.root), patch.object(
                scan.platform, "system", return_value="Linux"), patch.object(
                scan.platform, "machine", return_value="x86_64"), patch.object(scan.tarfile, "open") as archive:
            with self.assertRaisesRegex(ValueError, "grype archive checksum mismatch"):
                scan.install_tools(cache, ["grype"])
        archive.assert_not_called()
        self.assertEqual([p.read_bytes() for p in cache.iterdir()], [b"inherited"])

    def test_daily_wrapper_inherits_both_job_bindings_into_scan_child(self):
        helper = self.root / "scripts/security/image_scan.py"
        helper.parent.mkdir(parents=True)
        helper.write_text('''import os
assert os.environ["GITHUB_TOKEN"] == "ghs_SYNTHETIC_JOB_TOKEN"
assert os.environ["GH_TOKEN"] == "ghs_SYNTHETIC_GH_TOKEN"
''')
        revision = "a" * 40
        run = {"id": 1, "event": "push", "head_branch": "dev", "path": rescan.PRODUCER,
               "head_sha": revision, "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "head_repository": {"full_name": "arcee-ai/nac"}}
        job = {"name": rescan.INVENTORY_JOB, "status": "completed", "steps": [
            {"name": rescan.INVENTORY_STEP, "status": "completed", "conclusion": "success"}]}

        def command(argv):
            if argv[:3] == ["gh", "run", "download"]:
                bundle = Path(argv[-1]) / "inventory"
                bundle.mkdir(parents=True)
                (bundle / "identity.json").write_text(json.dumps({"source_revision": revision, "image": "fixture"}))
                return ""
            endpoint = argv[2]
            if "/jobs?" in endpoint:
                return json.dumps({"jobs": [job]})
            if "/artifacts?" in endpoint:
                return json.dumps({"artifacts": [{"name": "managed-image-security-" + revision, "expired": False}]})
            return json.dumps({"workflow_runs": [run]})

        with patch.object(rescan, "ROOT", self.root), patch.object(rescan, "command", side_effect=command):
            self.assertEqual(rescan.rescan(self.root / "output"), 0)


if __name__ == "__main__":
    unittest.main()
