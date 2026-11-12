"""Synthetic pinned policy reads; no protected branch or approval is created."""

import base64
import tempfile
from pathlib import Path
import unittest
import uuid
from unittest import mock

import image_approval_caller as caller
import image_approval_intake as intake
import image_approval_source as source
from test_image_approval_intake import IMAGE, MERGE, NOW
import test_image_approval_readback as readback_tests


TRUSTED = "1" * 40
BASE = "2" * 40
TREE_TRUSTED = "3" * 40
TREE_CANDIDATE = "4" * 40


class PolicyAPI:
    def __init__(self):
        self.trusted = {path: b'{"schema_version":1,"rules":[]}'
                        for path in source.POLICIES}
        self.candidate = self.trusted.copy()
        self.modes = {}
        self.protected = True
        self.current = TRUSTED
        self.corrupt = False
        self.truncated = False

    def __call__(self, endpoint):
        prefix = f"repos/{intake.REPOSITORY}"
        if endpoint == prefix:
            return {"id": source.readback.REPOSITORY_ID,
                    "full_name": intake.REPOSITORY}
        if endpoint == f"{prefix}/branches/dev":
            return {"name": "dev", "protected": self.protected,
                    "commit": {"sha": self.current}}
        if endpoint == f"{prefix}/git/ref/heads/dev":
            return {"ref": "refs/heads/dev",
                    "object": {"type": "commit", "sha": self.current}}
        for revision, tree in ((TRUSTED, TREE_TRUSTED), (MERGE, TREE_CANDIDATE)):
            if endpoint == f"{prefix}/git/commits/{revision}":
                return {"sha": revision, "tree": {"sha": tree}}
            if endpoint == f"{prefix}/git/trees/{tree}?recursive=1":
                files = self.trusted if revision == TRUSTED else self.candidate
                return {"sha": tree, "truncated": self.truncated,
                        "tree": [{"path": path, "type": "blob",
                                  "mode": self.modes.get((revision, path), "100644"),
                                  "size": len(raw), "sha": readback_tests.git_sha(raw)}
                                 for path, raw in files.items()]}
        if endpoint.startswith(f"{prefix}/git/blobs/"):
            sha = endpoint.rsplit("/", 1)[-1]
            for raw in list(self.trusted.values()) + list(self.candidate.values()):
                if readback_tests.git_sha(raw) == sha:
                    return {"sha": sha, "size": len(raw), "encoding": "base64",
                            "content": base64.b64encode(raw + (b"x" if self.corrupt else b"")).decode()}
        raise ValueError(f"unexpected API request {endpoint}")


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.api = PolicyAPI()

    def read(self):
        return source.read_policies(MERGE, TRUSTED, api=self.api)

    def test_current_protected_dev_and_exact_merge_blobs(self):
        snapshot = self.read()
        self.assertEqual(snapshot.trusted_revision, TRUSTED)
        self.assertEqual(snapshot.candidate_revision, MERGE)
        self.assertEqual(snapshot.exceptions, self.api.trusted[source.POLICIES[0]])
        self.assertEqual(source.recheck_current(snapshot, api=self.api), snapshot)

    def test_untrusted_base_cannot_be_selected(self):
        with self.assertRaisesRegex(ValueError, "current dev"):
            source.read_policies(MERGE, BASE, api=self.api)

    def test_changed_candidate_or_current_dev_fails(self):
        self.api.candidate[source.POLICIES[0]] += b" "
        with self.assertRaisesRegex(ValueError, "candidate source policy"):
            self.read()
        self.api.candidate = self.api.trusted.copy()
        snapshot = self.read()
        self.api.current = "5" * 40
        with self.assertRaisesRegex(ValueError, "current dev"):
            source.recheck_current(snapshot, api=self.api)

    def test_symlink_truncated_corrupt_and_missing_fail(self):
        self.api.modes[(MERGE, source.POLICIES[0])] = "120000"
        with self.assertRaisesRegex(ValueError, "file mode"):
            self.read()
        self.api.modes.clear()
        self.api.truncated = True
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.read()
        self.api.truncated = False
        self.api.corrupt = True
        with self.assertRaisesRegex(ValueError, "blob bytes"):
            self.read()
        self.api.corrupt = False
        del self.api.candidate[source.POLICIES[1]]
        with self.assertRaisesRegex(ValueError, "file mode"):
            self.read()

    def test_unprotected_dev_and_wrong_repository_fail(self):
        self.api.protected = False
        with self.assertRaisesRegex(ValueError, "protected branch"):
            self.read()
        self.api.protected = True
        original = self.api
        def wrong_repo(endpoint):
            value = original(endpoint)
            if endpoint == f"repos/{intake.REPOSITORY}":
                value["id"] += 1
            return value
        with self.assertRaisesRegex(ValueError, "repository"):
            source.read_policies(MERGE, TRUSTED, api=wrong_repo)


class CallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixture = readback_tests.ReadbackTests()
        self.fixture.setUp()
        self.snapshot = self.fixture.read()
        self.record = self.fixture.record
        self.policies = source.SourceSnapshot(TRUSTED, MERGE, b"trusted", b"applicable")
        self.metadata = {"id": self.record["artifact_id"],
                         "digest": self.record["artifact_digest"], "expired": False}
        self.downloads = []
        self.replays = []

    def api(self, endpoint):
        if endpoint == f"repos/{intake.REPOSITORY}/actions/artifacts/{self.record['artifact_id']}":
            return self.metadata
        return self.fixture.api(endpoint)

    def download(self, artifact_id, digest, destination, *, read_token):
        self.downloads.append((artifact_id, digest, read_token))
        destination.write_bytes(b"archive")

    def replay(self, number, merge, image, archive, workspace, **options):
        self.replays.append((number, merge, image))
        self.assertEqual(archive.read_bytes(), b"archive")
        self.assertEqual(options["source_policy"].read_bytes(), b"trusted")
        self.assertEqual(options["candidate_policy"].read_bytes(), b"trusted")
        self.assertEqual(options["source_applicability"].read_bytes(), b"applicable")
        self.assertEqual(options["candidate_applicability"].read_bytes(), b"applicable")
        self.assertFalse(workspace.exists())
        return {"state": "success", "sha": merge}

    def invoke(self, *, workspace=None):
        with (mock.patch.object(caller.source, "read_policies", return_value=self.policies),
              mock.patch.object(caller.source, "recheck_current", return_value=self.policies),
              mock.patch.object(caller.readback, "read_current", return_value=self.snapshot),
              mock.patch.object(caller.readback, "recheck_current", return_value=self.snapshot)):
            return caller.run_from_github(self.record["pull_request"], MERGE, IMAGE,
                workspace or self.root / "caller", trusted_revision=TRUSTED,
                read_token="read-only",
                api=self.api, download=self.download, run_replay=self.replay,
                clock=lambda: NOW)

    def test_stages_exact_inputs_and_only_approved_artifact(self):
        self.assertEqual(self.invoke()["sha"], MERGE)
        self.assertEqual(self.downloads, [(self.record["artifact_id"],
                         self.record["artifact_digest"], "read-only")])
        self.assertEqual(self.replays, [(self.record["pull_request"], MERGE, IMAGE)])

    def test_workspace_inside_repository_denied_before_download_or_write(self):
        workspace = caller.replay.ROOT / f".approval-caller-test-{uuid.uuid4().hex}"
        with self.assertRaisesRegex(ValueError, "outside repository"):
            self.invoke(workspace=workspace)
        self.assertFalse(workspace.exists())
        self.assertFalse(self.downloads)
        self.assertFalse(self.replays)

    def test_bad_artifact_metadata_fails_before_download(self):
        self.metadata["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "artifact metadata"):
            self.invoke()
        self.assertFalse(self.downloads)

    def test_source_recheck_failure_suppresses_proposal(self):
        with (mock.patch.object(caller.source, "read_policies", return_value=self.policies),
              mock.patch.object(caller.source, "recheck_current", side_effect=ValueError("moved")),
              mock.patch.object(caller.readback, "read_current", return_value=self.snapshot)):
            with self.assertRaisesRegex(ValueError, "moved"):
                caller.run_from_github(self.record["pull_request"], MERGE, IMAGE,
                    self.root / "caller", trusted_revision=TRUSTED, read_token="read-only",
                    api=self.api, download=self.download, run_replay=self.replay,
                    clock=lambda: NOW)

    def test_protected_record_recheck_failure_suppresses_proposal(self):
        with (mock.patch.object(caller.source, "read_policies", return_value=self.policies),
              mock.patch.object(caller.source, "recheck_current", return_value=self.policies),
              mock.patch.object(caller.readback, "read_current", return_value=self.snapshot),
              mock.patch.object(caller.readback, "recheck_current", side_effect=ValueError("revoked"))):
            with self.assertRaisesRegex(ValueError, "revoked"):
                caller.run_from_github(self.record["pull_request"], MERGE, IMAGE,
                    self.root / "caller", trusted_revision=TRUSTED, read_token="read-only",
                    api=self.api, download=self.download, run_replay=self.replay,
                    clock=lambda: NOW)

    def test_missing_trusted_policy_fails_before_download(self):
        with (mock.patch.object(caller.source, "read_policies", side_effect=ValueError("missing trusted blob")),
              mock.patch.object(caller.readback, "read_current", return_value=self.snapshot)):
            with self.assertRaisesRegex(ValueError, "missing trusted blob"):
                caller.run_from_github(self.record["pull_request"], MERGE, IMAGE,
                    self.root / "caller", trusted_revision=TRUSTED, read_token="read-only",
                    api=self.api, download=self.download, run_replay=self.replay,
                    clock=lambda: NOW)
        self.assertFalse(self.downloads)

    def test_failed_download_never_starts_replay(self):
        def failed_download(*_args, **_kwargs):
            raise ValueError("digest mismatch")
        with (mock.patch.object(caller.source, "read_policies", return_value=self.policies),
              mock.patch.object(caller.readback, "read_current", return_value=self.snapshot)):
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                caller.run_from_github(self.record["pull_request"], MERGE, IMAGE,
                    self.root / "caller", trusted_revision=TRUSTED, read_token="read-only",
                    api=self.api, download=failed_download, run_replay=self.replay,
                    clock=lambda: NOW)
        self.assertFalse(self.replays)


if __name__ == "__main__":
    unittest.main()
