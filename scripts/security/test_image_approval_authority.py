"""Synthetic authority denials; no live branch, reviewer or status is created."""

import base64
import copy
from pathlib import Path
import unittest

import image_approval_authority as authority
import image_approval_intake as intake
import image_approval_readback as readback
import test_image_approval_readback as readback_tests
from test_image_approval_intake import IMAGE, MERGE, NOW


DEV = "1" * 40
DEV_TREE = "2" * 40
COMMIT = "3" * 40
HEAD = "4" * 40
MERGED_TREE = "5" * 40
REVIEWER_ID = 88
LOGIN = "securityowner"
WORKFLOW = ".github/workflows/image-approval-replay.yml"
WORKFLOW_BYTES = b"name: Synthetic protected replay\n"


def rule(rule_id, branch):
    return {"id": rule_id, "target": "branch", "source_type": "Repository",
            "source": intake.REPOSITORY, "enforcement": "active", "bypass_actors": [],
            "created_at": "2026-11-01T09:00:00.000-08:00",
            "updated_at": "2026-11-02T09:00:00.000-08:00",
            "conditions": {"ref_name": {"include": [f"refs/heads/{branch}"], "exclude": []}},
            "rules": [{"type": "deletion"}, {"type": "non_fast_forward"},
                      {"type": "pull_request", "parameters": {
                          "allowed_merge_methods": ["squash"],
                          "dismiss_stale_reviews_on_push": True,
                          "require_code_owner_review": True,
                          "require_last_push_approval": True,
                          "required_review_thread_resolution": True,
                          "required_approving_review_count": 1}}]}


class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.root = authority.ROOT
        self.fixture = readback_tests.ReadbackTests()
        self.fixture.setUp()
        self.owners = f"* @{LOGIN}\n".encode()
        self.fixture.files[authority.CODEOWNERS] = self.owners
        self.snapshot = readback.read_current(self.fixture.record["pull_request"], MERGE,
                                               IMAGE, now=NOW, api=self.fixture.api)
        self.pins = authority.AuthorityPins(
            trusted_dev_revision=DEV, dev_ruleset_id=11, approval_ruleset_id=12,
            reviewer_id=REVIEWER_ID, reviewer_login=LOGIN,
            codeowners_blob=readback_tests.git_sha(self.owners),
            workflow_path=WORKFLOW, workflow_blob=readback_tests.git_sha(WORKFLOW_BYTES))
        self.rules = {11: rule(11, "dev"), 12: rule(12, readback.BRANCH)}
        self.review = {"id": 99, "user": {"id": REVIEWER_ID, "login": LOGIN},
                       "state": "APPROVED", "commit_id": HEAD,
                       "submitted_at": "2026-11-11T11:00:00Z"}
        self.pr = {"number": 456, "state": "closed", "merged": True,
                   "merge_commit_sha": COMMIT, "merged_at": "2026-11-11T11:30:00Z",
                   "base": {"ref": readback.BRANCH,
                            "repo": {"id": readback.REPOSITORY_ID}},
                   "head": {"sha": HEAD, "user": {"id": 42}},
                   "user": {"id": 42}}
        self.path_commits = {}
        self.merged_owners_sha = readback_tests.git_sha(self.owners)
        self.environment = {"GITHUB_REPOSITORY": intake.REPOSITORY,
            "GITHUB_REPOSITORY_ID": str(readback.REPOSITORY_ID),
            "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/dev",
            "GITHUB_SHA": DEV, "GITHUB_WORKFLOW_SHA": DEV,
            "GITHUB_WORKFLOW_REF": f"{intake.REPOSITORY}/{WORKFLOW}@refs/heads/dev"}

    def api(self, endpoint):
        prefix = f"repos/{intake.REPOSITORY}"
        if endpoint == prefix:
            return {"id": readback.REPOSITORY_ID, "full_name": intake.REPOSITORY,
                    "default_branch": "dev"}
        if endpoint == f"{prefix}/branches/dev":
            return {"name": "dev", "protected": True, "commit": {"sha": DEV}}
        if endpoint == f"{prefix}/git/ref/heads/dev":
            return {"ref": "refs/heads/dev", "object": {"type": "commit", "sha": DEV}}
        if endpoint == f"{prefix}/git/commits/{DEV}":
            return {"sha": DEV, "tree": {"sha": DEV_TREE}}
        if endpoint == f"{prefix}/git/commits/{COMMIT}":
            return {"sha": COMMIT, "tree": {"sha": MERGED_TREE}}
        if endpoint == f"{prefix}/git/trees/{MERGED_TREE}?recursive=1":
            return {"sha": MERGED_TREE, "truncated": False,
                    "tree": [{"path": authority.CODEOWNERS, "type": "blob", "mode": "100644",
                              "size": len(self.owners), "sha": self.merged_owners_sha}]}
        if endpoint == f"{prefix}/git/trees/{DEV_TREE}?recursive=1":
            return {"sha": DEV_TREE, "truncated": False,
                    "tree": [{"path": WORKFLOW, "type": "blob", "mode": "100644",
                              "size": len(WORKFLOW_BYTES),
                              "sha": readback_tests.git_sha(WORKFLOW_BYTES)}]}
        if endpoint == f"{prefix}/git/blobs/{readback_tests.git_sha(WORKFLOW_BYTES)}":
            return {"sha": readback_tests.git_sha(WORKFLOW_BYTES),
                    "size": len(WORKFLOW_BYTES), "encoding": "base64",
                    "content": base64.b64encode(WORKFLOW_BYTES).decode()}
        if endpoint.startswith(f"{prefix}/rulesets/"):
            return copy.deepcopy(self.rules[int(endpoint.rsplit("/", 1)[-1])])
        return self.fixture.api(endpoint)

    def list_api(self, endpoint):
        prefix = f"repos/{intake.REPOSITORY}"
        if endpoint.startswith(f"{prefix}/commits?sha={self.snapshot.branch_revision}&path="):
            path = endpoint.split("&path=", 1)[1].removesuffix("&per_page=1")
            return [{"sha": self.path_commits.get(path, COMMIT)}]
        if endpoint == f"{prefix}/commits/{COMMIT}/pulls?per_page=2":
            return [copy.deepcopy(self.pr)]
        if endpoint == f"{prefix}/pulls/{self.pr['number']}/reviews?per_page=100":
            return [copy.deepcopy(self.review)]
        raise ValueError(f"unexpected list API request: {endpoint}")

    def git(self, root, *args):
        values = {("rev-parse", "--show-toplevel"): str(root.resolve()),
                  ("rev-parse", "HEAD"): DEV,
                  ("remote", "get-url", "origin"): f"https://github.com/{intake.REPOSITORY}.git",
                  ("status", "--porcelain", "--untracked-files=all"): ""}
        return values[args]

    def verify(self, *, api=None, list_api=None, environment=None, git=None, pins=None):
        return authority.verify(self.snapshot, pins=pins or self.pins, now=NOW,
            api=api or self.api, list_api=list_api or self.list_api,
            root=self.root, environment=environment or self.environment, git=git or self.git)

    def test_unset_anchors_fail_before_any_api(self):
        with self.assertRaisesRegex(ValueError, "trusted dev revision"):
            authority.verify(self.snapshot, now=NOW,
                api=lambda _: self.fail("API called before authority pins"))

    def test_exact_rules_reviewed_closure_and_protected_code(self):
        self.assertIsNone(self.verify())
        # No result can be carried to another image as an authority receipt.
        with self.assertRaisesRegex(ValueError, "protected readback required"):
            authority.verify(None, pins=self.pins, now=NOW, api=self.api,
                list_api=self.list_api, root=self.root,
                environment=self.environment, git=self.git)

    def test_bypass_absent_is_not_explicit_empty_and_stale_review_denied(self):
        self.rules[12]["bypass_actors"] = None
        with self.assertRaisesRegex(ValueError, "bypass"):
            self.verify()
        self.rules[12]["bypass_actors"] = [{"actor_id": 9, "actor_type": "User",
                                            "bypass_mode": "pull_request"}]
        with self.assertRaisesRegex(ValueError, "bypass"):
            self.verify()
        self.rules[12]["bypass_actors"] = []
        self.rules[11]["rules"][2]["parameters"]["dismiss_stale_reviews_on_push"] = False
        with self.assertRaisesRegex(ValueError, "reviewer"):
            self.verify()

    def test_wrong_ref_missing_pull_rule_and_direct_merge_fail(self):
        self.rules[12]["conditions"]["ref_name"]["include"] = ["~ALL"]
        with self.assertRaisesRegex(ValueError, "exact ref"):
            self.verify()
        self.rules[12] = rule(12, readback.BRANCH)
        self.rules[12]["rules"].pop()
        with self.assertRaisesRegex(ValueError, "PR-only"):
            self.verify()
        self.rules[12] = rule(12, readback.BRANCH)
        self.pr["merged"] = False
        with self.assertRaisesRegex(ValueError, "squash-merged"):
            self.verify()

    def test_every_exact_evidence_path_must_share_reviewed_commit(self):
        path = f"{self.fixture.root}/evidence/{self.snapshot.evidence[0][0]}"
        self.path_commits[path] = "f" * 40
        with self.assertRaisesRegex(ValueError, "reviewed together"):
            self.verify()

    def test_unreviewed_stale_dismissed_or_author_review_fails(self):
        self.review["state"] = "DISMISSED"
        with self.assertRaisesRegex(ValueError, "stale, dismissed"):
            self.verify()
        self.review["state"] = "APPROVED"
        self.review["commit_id"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "final head"):
            self.verify()
        self.review["commit_id"] = HEAD
        self.pr["user"]["id"] = REVIEWER_ID
        with self.assertRaisesRegex(ValueError, "separate author"):
            self.verify()

    def test_codeowners_pin_or_workflow_checkout_change_fails(self):
        pins = authority.AuthorityPins(**{**self.pins.__dict__, "codeowners_blob": "f" * 40})
        with self.assertRaisesRegex(ValueError, "CODEOWNERS blob"):
            self.verify(pins=pins)
        environment = {**self.environment, "GITHUB_WORKFLOW_SHA": "f" * 40}
        with self.assertRaisesRegex(ValueError, "workflow event"):
            self.verify(environment=environment)
        def dirty(root, *args):
            return "?? attacker.py" if args[0] == "status" else self.git(root, *args)
        with self.assertRaisesRegex(ValueError, "exact, clean dev"):
            self.verify(git=dirty)

    def test_ruleset_changed_after_review_cannot_retroactively_authorize_record(self):
        self.rules[12]["updated_at"] = "2026-11-11T12:00:00Z"
        with self.assertRaisesRegex(ValueError, "changed after"):
            self.verify()

    def test_codeowners_must_exist_at_record_merge_commit(self):
        self.merged_owners_sha = "f" * 40
        with self.assertRaisesRegex(ValueError, "did not merge under pinned CODEOWNERS"):
            self.verify()

    def test_review_pagination_or_ambiguous_association_fails(self):
        original = self.list_api
        def many_reviews(endpoint):
            rows = original(endpoint)
            return rows * 100 if "/reviews?" in endpoint else rows
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.verify(list_api=many_reviews)
        def many_pulls(endpoint):
            rows = original(endpoint)
            return rows * 2 if "/pulls?" in endpoint else rows
        with self.assertRaisesRegex(ValueError, "unique merged"):
            self.verify(list_api=many_pulls)

    def test_current_branch_move_fails_even_if_record_bytes_were_read(self):
        self.fixture.move_after_first = True
        with self.assertRaisesRegex(ValueError, "approval branch moved"):
            self.verify()

    def test_ruleset_movement_during_read_fails(self):
        calls = 0
        def moving_ruleset(endpoint):
            nonlocal calls
            value = self.api(endpoint)
            if endpoint.endswith("/rulesets/12"):
                calls += 1
                if calls == 2:
                    value["updated_at"] = "2026-11-03T09:00:00.000-08:00"
            return value
        with self.assertRaisesRegex(ValueError, "changed during"):
            self.verify(api=moving_ruleset)


if __name__ == "__main__":
    unittest.main()
