"""Inert release-build resource contract; no command or fixture is executed."""

from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import run as performance


class ReleaseBuildResourceContract(unittest.TestCase):
    def test_release_command_and_workflow_respect_two_job_ceiling(self):
        class CapturedRelease(Exception):
            pass
        runner = object.__new__(performance.Calibration)
        runner.private = Path("/fixture/private")
        runner.report = {}
        runner.args = SimpleNamespace(source_root=Path("/fixture/product"), target_sha="a" * 40,
            harness_root=Path("/fixture/harness"), harness_sha="b" * 40,
            tools_root=Path("/fixture/tools"), tools_sha="c" * 40)
        runner.phase = lambda name: None
        runner.checkout = lambda root, revision: {"source_sha": revision, "dirty": False}
        captured = {}
        def command(argv, name, **options):
            if name == "setup":
                self.assertEqual(argv, ["make", "setup"])
                return
            self.assertEqual(name, "release-engine")
            captured.update(argv=argv, env=options["env"], limit=options["limit"])
            raise CapturedRelease()  # Stop before copy, app build or probe creation.
        runner.command = command
        with patch.object(performance, "PerformanceDriver", return_value=object()), \
                patch.dict(performance.os.environ, {"CARGO_BUILD_JOBS": "64"}):
            with self.assertRaises(CapturedRelease):
                runner.build()
        self.assertEqual(captured["env"]["CARGO_BUILD_JOBS"], "2")
        self.assertEqual(captured["argv"], ["cargo", "build", "--release", "--locked",
                                         "-p", "nac-server", "--bin", "nac-web"])
        self.assertEqual(captured["env"]["NAC_SOURCE_REVISION"], "a" * 40)
        self.assertEqual(captured["env"]["CARGO_TARGET_DIR"], "/fixture/private/cargo")
        self.assertEqual(captured["limit"], 900)
        workflow = performance.HERE.parents[2] / ".github/workflows/macos-performance.yml"
        self.assertIn('CARGO_BUILD_JOBS: "2"', workflow.read_text())
