"""Synthetic orchestration tests; no live approval, scan or status write."""

import hashlib
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest import mock

import image_approval_intake as intake
import image_approval_replay as replay
from test_image_approval_intake import fixture as provenance_fixture, IMAGE, MERGE, NOW
from test_image_approval_readback import ReadbackTests, encode


def write(path, value):
    path.write_bytes(encode(value))


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / "artifact.zip"
        self.archive.write_bytes(b"synthetic archive; extraction is separately tested")
        self.readback = ReadbackTests()
        self.readback.setUp()
        self.record = self.readback.record
        self.record["artifact_digest"] = "sha256:" + hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.readback.files[f"{self.readback.root}/record.json"] = encode(self.record)
        _, self.objects = provenance_fixture()
        self.objects["artifact"]["digest"] = self.record["artifact_digest"]
        self.workspace = self.root / "replay"
        self.source = {}
        for name in ("source-policy", "candidate-policy", "source-applicability", "candidate-applicability"):
            path = self.root / (name + ".json")
            path.write_bytes(b'{}')
            self.source[name.replace("-", "_")] = path
        self.collected_at = "2026-11-11T11:30:00Z"
        self.loads = 0
        self.scans = 0
        self.change_pr_on_recheck = False

    def api(self, endpoint):
        prefix = f"repos/{intake.REPOSITORY}"
        mapping = {
            f"{prefix}/pulls/{self.record['pull_request']}": "pr",
            f"{prefix}/git/ref/pull/{self.record['pull_request']}/merge": "merge_ref",
            f"{prefix}/actions/runs/{self.record['run_id']}": "run",
            f"{prefix}/actions/jobs/{self.record['build_job_id']}": "build_job",
            f"{prefix}/actions/artifacts/{self.record['artifact_id']}": "artifact",
        }
        if endpoint in mapping:
            item = self.objects[mapping[endpoint]].copy()
            if mapping[endpoint] == "pr" and self.change_pr_on_recheck and self.scans:
                item["head"] = {"sha": "0" * 40}
            return item
        return self.readback.api(endpoint)

    def extract(self, archive, destination, **_kwargs):
        destination.mkdir()
        image_tar = destination / "image.tar"
        image_tar.write_bytes(b"synthetic image")
        inventory = destination / "inventory"
        inventory.mkdir()
        write(inventory / "applicability-context.json", {
            "schema_version": 2, "collected_at": self.collected_at})
        return image_tar, inventory

    def load(self, image_tar, image):
        self.assertEqual(image, IMAGE)
        self.assertTrue(image_tar.is_file())
        self.loads += 1

    def scan(self, command, *, check):
        self.assertFalse(check)
        self.assertIn("--reviewed-image-approval-sha256", command)
        self.assertEqual(command[command.index("--reviewed-image-approval-sha256") + 1],
                         self.record["approval_sha256"])
        self.scans += 1
        output = Path(command[command.index("--output") + 1])
        output.mkdir()
        write(output / "findings.json", [])
        write(output / "policy-result.json", {
            "blocking": [], "excepted": [], "reporting": []})
        write(output / "applicability-result.json", {
            "schema_version": 1, "status": "verified", "approval_mode": "post-build",
            "policy_sha256": self.record["approval_sha256"],
            "candidate_policy_sha256": "0" * 64,
            "raw_findings": [], "dispositions": [], "unresolved_indexes": []})
        write(output / "decision.json", {
            "schema_version": 1, "image": IMAGE, "source_revision": MERGE,
            "blocking_indexes": [],
            "raw_findings_sha256": replay.sha256(output / "findings.json"),
            "source_policy_result_sha256": replay.sha256(output / "policy-result.json"),
            "applicability_result_sha256": replay.sha256(output / "applicability-result.json")})
        write(output / "result.json", {
            "status": "passed", "image": IMAGE, "findings": 0, "blocking": 0,
            "applicability": "verified",
            "decision_sha256": replay.sha256(output / "decision.json")})
        return mock.Mock(returncode=0)

    def invoke(self):
        with mock.patch.object(replay.candidate, "extract_candidate", side_effect=self.extract):
            return replay.replay(self.record["pull_request"], MERGE, IMAGE,
                self.archive, self.workspace,
                source_policy=self.source["source_policy"],
                candidate_policy=self.source["candidate_policy"],
                source_applicability=self.source["source_applicability"],
                candidate_applicability=self.source["candidate_applicability"],
                clock=lambda: NOW, api=self.api, scan=self.scan, load=self.load)

    def test_proposes_only_after_exact_replay_and_current_recheck(self):
        status = self.invoke()
        self.assertEqual(status["state"], "success")
        self.assertEqual(status["sha"], MERGE)
        self.assertEqual((self.loads, self.scans), (1, 1))
        self.assertTrue((self.workspace / "review/policy.json").read_bytes() ==
                        self.readback.files[f"{self.readback.root}/policy.json"])

    def test_stale_or_future_v4_context_never_loads_or_scans(self):
        for collected_at in ("2026-11-10T11:59:59Z", "2026-11-11T12:00:01Z"):
            with self.subTest(collected_at=collected_at):
                self.collected_at = collected_at
                with self.assertRaisesRegex(ValueError, "stale/future frozen observation"):
                    self.invoke()
                self.assertEqual((self.loads, self.scans), (0, 0))
                self.workspace.rename(self.root / ("failed-" + collected_at[:10] + collected_at[11:13]))

    def test_wrong_archive_provenance_and_changed_live_pr_fail(self):
        self.objects["artifact"]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "artifact identity"):
            self.invoke()
        self.assertEqual((self.loads, self.scans), (0, 0))
        self.objects["artifact"]["digest"] = self.record["artifact_digest"]
        self.change_pr_on_recheck = True
        with self.assertRaisesRegex(ValueError, "pull request head/base changed"):
            self.invoke()
        self.assertEqual((self.loads, self.scans), (1, 1))

    def test_replay_receipt_must_preserve_raw_decision(self):
        original = self.scan
        def tamper(command, *, check):
            result = original(command, check=check)
            output = Path(command[command.index("--output") + 1])
            write(output / "findings.json", [{"unreviewed": True}])
            return result
        self.scan = tamper
        with self.assertRaisesRegex(ValueError, "decision inputs changed"):
            self.invoke()

    def test_changed_zip_or_failed_scanner_cannot_propose_success(self):
        self.archive.write_bytes(b"different archive")
        with self.assertRaisesRegex(ValueError, "downloaded artifact archive digest changed"):
            self.invoke()
        self.assertEqual((self.loads, self.scans), (0, 0))
        self.archive.write_bytes(b"synthetic archive; extraction is separately tested")
        def failed_scan(_command, *, check):
            self.assertFalse(check)
            self.scans += 1
            return mock.Mock(returncode=2)
        self.scan = failed_scan
        with self.assertRaisesRegex(ValueError, "did not exit successfully"):
            self.invoke()
        self.assertEqual((self.loads, self.scans), (1, 1))

    def test_moved_record_during_scan_fails_recheck(self):
        original = self.scan
        def move_branch(command, *, check):
            result = original(command, check=check)
            self.readback.revision = "e" * 40
            return result
        self.scan = move_branch
        with self.assertRaisesRegex(ValueError, "approval changed"):
            self.invoke()

    def test_source_paths_must_be_separate_regular_files(self):
        linked = self.root / "linked-policy.json"
        linked.symlink_to(self.source["source_policy"])
        self.source["source_policy"] = linked
        with self.assertRaisesRegex(ValueError, "replay input path"):
            self.invoke()
        self.assertEqual((self.loads, self.scans), (0, 0))

    def test_workspace_inside_repository_denied_before_review_staging(self):
        self.workspace = replay.ROOT / f".approval-replay-test-{uuid.uuid4().hex}"
        with self.assertRaisesRegex(ValueError, "outside repository"):
            self.invoke()
        self.assertFalse(self.workspace.exists())
        self.assertEqual((self.loads, self.scans), (0, 0))

    def test_no_live_workflow_invokes_replay(self):
        root = Path(__file__).resolve().parents[2]
        for workflow in (root / ".github/workflows").glob("*.yml"):
            self.assertNotIn("image_approval_replay", workflow.read_text())


if __name__ == "__main__":
    unittest.main()
