"""Synthetic contract tests; no production image or finding is approved."""

import datetime as dt
import hashlib
import json
import unittest

import image_approval_intake as intake


HEAD = "a" * 40
BASE = "b" * 40
MERGE = "c" * 40
BRANCH = "d" * 40
IMAGE = "sha256:" + "e" * 64
POLICY = b'{"schema_version":1,"rules":[{"synthetic":true}]}'
NOW = dt.datetime(2026, 11, 11, 12, 0, tzinfo=dt.timezone.utc)


def fixture():
    artifact_digest = "sha256:" + "f" * 64
    record = {
        "schema_version": 1, "repository": intake.REPOSITORY,
        "pull_request": 440, "head_sha": HEAD, "base_sha": BASE,
        "merge_sha": MERGE, "image": IMAGE, "run_id": 123, "run_attempt": 2,
        "build_job_id": 456, "artifact_id": 789,
        "artifact_name": f"managed-image-candidate-{MERGE}-123-2",
        "artifact_digest": artifact_digest,
        "approval_sha256": hashlib.sha256(POLICY).hexdigest(),
        "approved_at": "2026-11-11T11:00:00Z",
        "expires_at": "2026-11-12T11:00:00Z", "state": "active",
    }
    inputs = {
        "pr": {"number": 440, "state": "open", "head": {"sha": HEAD},
               "base": {"sha": BASE}, "merge_commit_sha": MERGE},
        "merge_ref": {"ref": "refs/pull/440/merge", "object": {"sha": MERGE}},
        "run": {"id": 123, "event": "pull_request", "path": intake.WORKFLOW_PATH,
                "head_sha": HEAD, "run_attempt": 3,
                "pull_requests": [{"number": 440, "head": {"sha": HEAD},
                                   "base": {"sha": BASE}}]},
        "build_job": {"id": 456, "run_attempt": 2,
                      "name": intake.BUILD_JOB_NAME, "conclusion": "success",
                      "started_at": "2026-11-11T10:00:00Z",
                      "completed_at": "2026-11-11T10:30:00Z"},
        "artifact": {"id": 789, "name": record["artifact_name"],
                     "digest": artifact_digest, "expired": False,
                     "created_at": "2026-11-11T10:25:00Z",
                     "workflow_run": {"id": 123, "head_sha": HEAD}},
        "downloaded_artifact_digest": artifact_digest,
        "approval_branch_ref": {"ref": intake.APPROVAL_BRANCH,
                                "object": {"sha": BRANCH}},
        "record_fetched_at_sha": BRANCH,
    }
    return record, inputs


def raw(record):
    return json.dumps(record, sort_keys=True).encode()


class IntakeTests(unittest.TestCase):
    def test_synthetic_nonempty_exact_image_accepts_replay(self):
        record, inputs = fixture()
        result = intake.validate_record(raw(record), POLICY, now=NOW)
        branch = intake.validate_provenance(result, **inputs)
        status = intake.validate_replay(result, {"status": "passed", "blocking": 0,
                                                "image": IMAGE, "applicability": "verified",
                                                "decision_sha256": "1" * 64},
                                        branch_sha_before=branch, branch_sha_after=BRANCH)
        self.assertEqual(status["sha"], MERGE)
        self.assertEqual(status["context"], intake.STATUS_CONTEXT)

    def test_record_mutations_fail_closed(self):
        changes = [
            ("state", "revoked"), ("head_sha", "invalid"),
            ("image", "sha256:invalid"), ("run_attempt", 0),
            ("artifact_digest", "sha256:invalid"),
            ("approval_sha256", "0" * 64),
            ("expires_at", "2026-11-11T11:59:59Z"),
            ("approved_at", "2026-11-11T12:00:01Z"),
        ]
        for field, value in changes:
            with self.subTest(field=field):
                record, _ = fixture()
                record[field] = value
                with self.assertRaises(intake.ApprovalError):
                    intake.validate_record(raw(record), POLICY, now=NOW)
        record, _ = fixture()
        with self.assertRaises(intake.ApprovalError):
            intake.validate_record(raw(record), POLICY + b" ", now=NOW)
        with self.assertRaises(intake.ApprovalError):
            intake.validate_record(b'{"state":"active","state":"active"}', POLICY, now=NOW)

    def test_wrong_run_attempt_head_and_artifact_fail_closed(self):
        mutations = [
            ("pr", "head", "sha", "0" * 40),
            ("pr", "base", "sha", "0" * 40),
            ("merge_ref", "object", "sha", "0" * 40),
            ("run", "pull_requests", 0, {"number": 441}),
            ("build_job", "run_attempt", None, 1),
            ("build_job", "conclusion", None, "failure"),
            ("artifact", "digest", None, "sha256:" + "0" * 64),
            ("artifact", "created_at", None, "2026-11-11T10:31:00Z"),
            ("artifact", "workflow_run", "id", 999),
            ("approval_branch_ref", "object", "sha", "0" * 40),
        ]
        for area, field, nested, value in mutations:
            with self.subTest(area=area, field=field):
                record, inputs = fixture()
                target = inputs[area]
                if nested is None:
                    target[field] = value
                else:
                    target[field][nested] = value
                with self.assertRaises(intake.ApprovalError):
                    intake.validate_provenance(record, **inputs)
        record, inputs = fixture()
        inputs["downloaded_artifact_digest"] = "sha256:" + "0" * 64
        with self.assertRaises(intake.ApprovalError):
            intake.validate_provenance(record, **inputs)
        record, inputs = fixture()
        inputs["record_fetched_at_sha"] = "0" * 40
        with self.assertRaises(intake.ApprovalError):
            intake.validate_provenance(record, **inputs)

    def test_stale_branch_or_failed_replay_cannot_propose_success(self):
        record, _ = fixture()
        passing = {"status": "passed", "blocking": 0, "image": IMAGE,
                   "applicability": "verified", "decision_sha256": "1" * 64}
        for result, after in [
            (passing, "0" * 40),
            ({**passing, "status": "blocked"}, BRANCH),
            ({**passing, "blocking": 1}, BRANCH),
            ({**passing, "image": "sha256:" + "0" * 64}, BRANCH),
            ({**passing, "applicability": "inactive"}, BRANCH),
        ]:
            with self.assertRaises(intake.ApprovalError):
                intake.validate_replay(record, result, branch_sha_before=BRANCH,
                                       branch_sha_after=after)

    def test_status_publication_fails_closed(self):
        status = {"state": "success", "context": intake.STATUS_CONTEXT,
                  "description": "test", "sha": MERGE}

        def broken(*_args, **_kwargs):
            raise OSError("unavailable")

        with self.assertRaisesRegex(intake.ApprovalError, "publication failed"):
            intake.publish_status(status, app_token="synthetic",
                                  expected_app_bot="image-approval[bot]", opener=broken)

        class Response:
            status = 201

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"state": "failure", "context": intake.STATUS_CONTEXT,
                                   "url": "https://api.github.com/repos/arcee-ai/nac/statuses/1"}).encode()

        with self.assertRaisesRegex(intake.ApprovalError, "does not confirm"):
            intake.publish_status(status, app_token="synthetic",
                                  expected_app_bot="image-approval[bot]",
                                  opener=lambda *_args, **_kwargs: Response())

    def test_status_publication_uses_exact_target_and_app_identity(self):
        status = {"state": "success", "context": intake.STATUS_CONTEXT,
                  "description": "synthetic exact-image pass", "sha": MERGE}
        requests = []

        class Response:
            status = 201

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"state": "success", "context": intake.STATUS_CONTEXT,
                    "creator": {"login": "image-approval[bot]"},
                    "url": f"https://api.github.com/repos/arcee-ai/nac/statuses/{MERGE}"}).encode()

        def opener(request, **_kwargs):
            requests.append(request)
            return Response()

        intake.publish_status(status, app_token="synthetic",
                              expected_app_bot="image-approval[bot]", opener=opener)
        self.assertEqual(requests[0].full_url,
                         f"https://api.github.com/repos/arcee-ai/nac/statuses/{MERGE}")
        self.assertEqual(requests[0].get_method(), "POST")
        self.assertEqual(json.loads(requests[0].data)["context"], intake.STATUS_CONTEXT)

    def test_current_revocation_proposes_failure(self):
        record, inputs = fixture()
        record["state"] = "revoked"
        parsed = intake.validate_record(raw(record), POLICY, now=NOW, allow_revoked=True)
        status = intake.revocation_status(parsed, pr=inputs["pr"],
            merge_ref=inputs["merge_ref"],
            approval_branch_ref=inputs["approval_branch_ref"],
            record_fetched_at_sha=BRANCH)
        self.assertEqual(status["state"], "failure")
        with self.assertRaises(intake.ApprovalError):
            intake.revocation_status(parsed, pr=inputs["pr"], merge_ref=inputs["merge_ref"],
                approval_branch_ref=inputs["approval_branch_ref"],
                record_fetched_at_sha="0" * 40)


if __name__ == "__main__":
    unittest.main()
