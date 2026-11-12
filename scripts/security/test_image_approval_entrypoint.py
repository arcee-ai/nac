"""Inactive entrypoint call-order and no-transfer controls."""

from dataclasses import replace
from pathlib import Path
import unittest
from unittest import mock

import image_approval_authority as authority
import image_approval_entrypoint as entrypoint
import image_approval_intake as intake
import test_image_approval_readback as readback_tests
from test_image_approval_intake import IMAGE, MERGE, NOW


def configured_pins():
    return authority.AuthorityPins(
        trusted_dev_revision="1" * 40, dev_ruleset_id=11,
        approval_ruleset_id=12, reviewer_id=88, reviewer_login="securityowner",
        codeowners_blob="2" * 40,
        workflow_path=".github/workflows/image-approval-replay.yml",
        workflow_blob="3" * 40)


class EntrypointTests(unittest.TestCase):
    def setUp(self):
        fixture = readback_tests.ReadbackTests()
        fixture.setUp()
        self.snapshot = fixture.read()
        self.record = fixture.record
        self.pins = configured_pins()
        self.workspace = Path("/private/tmp/synthetic-approval-entrypoint-unused")
        self.proposal = {"state": "success", "context": intake.STATUS_CONTEXT,
                         "description": "Exact frozen image passed reviewed security replay",
                         "sha": MERGE}

    def invoke(self, *, snapshots=None, authority_effect=None, proposal=None, token_source=None):
        snapshots = snapshots or [self.snapshot, self.snapshot]
        token_source = token_source or (lambda: "read-only-token")
        with (mock.patch.object(entrypoint.readback, "read_current", side_effect=snapshots) as read,
              mock.patch.object(entrypoint.authority, "verify", side_effect=authority_effect) as check,
              mock.patch.object(entrypoint.caller, "run_from_github",
                                return_value=self.proposal if proposal is None else proposal) as replay):
            result = entrypoint.prepare(self.record["pull_request"], MERGE, IMAGE,
                self.workspace, pins=self.pins, token_source=token_source, clock=lambda: NOW)
        return result, read, check, replay

    def test_same_snapshot_authority_brackets_exact_replay_without_receipt(self):
        result, read, check, replay = self.invoke()
        self.assertIsNone(result)
        self.assertEqual(read.call_count, 2)
        self.assertEqual(check.call_count, 2)
        self.assertEqual(check.call_args_list[0].args[0], self.snapshot)
        self.assertEqual(check.call_args_list[1].args[0], self.snapshot)
        self.assertEqual(replay.call_args.kwargs["trusted_revision"], self.pins.trusted_dev_revision)
        self.assertEqual(replay.call_args.kwargs["read_token"], "read-only-token")

    def test_unset_pins_fail_before_any_api_checkout_or_token_access(self):
        def forbidden():
            self.fail("token was accessed before pins")
        with (mock.patch.object(entrypoint.readback, "read_current") as read,
              mock.patch.object(entrypoint.authority, "verify") as check,
              mock.patch.object(entrypoint.caller, "run_from_github") as replay):
            with self.assertRaisesRegex(ValueError, "trusted dev revision"):
                entrypoint.prepare(self.record["pull_request"], MERGE, IMAGE,
                    self.workspace, token_source=forbidden, clock=lambda: NOW)
        read.assert_not_called()
        check.assert_not_called()
        replay.assert_not_called()

    def test_first_authority_failure_never_accesses_token_or_candidate(self):
        def forbidden():
            self.fail("token was accessed after failed authority")
        with (mock.patch.object(entrypoint.readback, "read_current", return_value=self.snapshot),
              mock.patch.object(entrypoint.authority, "verify", side_effect=ValueError("untrusted review")),
              mock.patch.object(entrypoint.caller, "run_from_github") as replay):
            with self.assertRaisesRegex(ValueError, "untrusted review"):
                entrypoint.prepare(self.record["pull_request"], MERGE, IMAGE,
                    self.workspace, pins=self.pins, token_source=forbidden, clock=lambda: NOW)
        replay.assert_not_called()

    def test_changed_protected_evidence_suppresses_proposal(self):
        changed = replace(self.snapshot, evidence=self.snapshot.evidence + (("f" * 64, b"changed"),))
        with (mock.patch.object(entrypoint.readback, "read_current",
                                side_effect=[self.snapshot, changed]),
              mock.patch.object(entrypoint.authority, "verify") as check,
              mock.patch.object(entrypoint.caller, "run_from_github", return_value=self.proposal)):
            with self.assertRaisesRegex(ValueError, "record, policy or evidence changed"):
                entrypoint.prepare(self.record["pull_request"], MERGE, IMAGE,
                    self.workspace, pins=self.pins, token_source=lambda: "read-only",
                    clock=lambda: NOW)
        self.assertEqual(check.call_count, 1)

    def test_second_authority_failure_or_cross_image_proposal_fails(self):
        with self.assertRaisesRegex(ValueError, "review revoked"):
            self.invoke(authority_effect=[None, ValueError("review revoked")])
        proposal = {**self.proposal, "sha": "f" * 40}
        with self.assertRaisesRegex(ValueError, "proposal differs"):
            self.invoke(proposal=proposal)

    def test_workflow_is_permanently_skipped_without_status_credential(self):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/image-approval-replay.yml"
        content = workflow.read_text()
        self.assertIn("if: ${{ github.repository == '' }}", content)
        self.assertIn("permissions: {}", content)
        self.assertNotIn("statuses: write", content)
        self.assertNotIn("secrets.", content)
        self.assertIn("on:\n  workflow_dispatch:", content)
        self.assertNotIn("on:\n  pull_request:", content)


if __name__ == "__main__":
    unittest.main()
