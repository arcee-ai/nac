"""Synthetic protected-byte readback; no finding or GitHub branch is approved."""

import base64
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import unittest

import image_applicability as applicability
import image_approval_readback as readback
from test_image_applicability import fixture as applicability_fixture
from test_image_approval_intake import fixture as intake_fixture, IMAGE, MERGE, NOW


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def git_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        model = applicability_fixture()
        rule = model["rules"][0]
        rule["binding"]["image"] = IMAGE
        rule["binding"]["source_revision"] = MERGE
        proof = model["record"]
        proof["binding"] = copy.deepcopy(rule["binding"])
        proof_raw = encode(proof)
        rule["evidence_sha256"] = applicability.digest(proof_raw)
        policy = encode({"schema_version": 1, "rules": [rule]})
        record, _ = intake_fixture()
        record["approval_sha256"] = applicability.digest(policy)
        self.record = record
        self.root = readback.directory(record["pull_request"], MERGE, IMAGE)
        self.files = {
            f"{self.root}/record.json": encode(record),
            f"{self.root}/policy.json": policy,
            f"{self.root}/evidence/{rule['evidence_sha256']}": proof_raw,
        }
        for name, raw in model["evidence"].items():
            self.files[f"{self.root}/evidence/{name}"] = raw
        self.revision = "d" * 40
        self.tree_sha = "f" * 40
        self.protected = True
        self.truncated = False
        self.modes = {}
        self.ref_calls = 0
        self.move_after_first = False
        self.corrupt_blob = False

    def api(self, endpoint):
        prefix = f"repos/{readback.intake.REPOSITORY}"
        if endpoint == prefix:
            return {"id": readback.REPOSITORY_ID,
                    "full_name": readback.intake.REPOSITORY}
        if endpoint == f"{prefix}/branches/{readback.BRANCH}":
            sha = "a" * 40 if self.move_after_first and self.ref_calls else self.revision
            return {"name": readback.BRANCH, "protected": self.protected,
                    "commit": {"sha": sha}}
        if endpoint == f"{prefix}/git/ref/heads/{readback.BRANCH}":
            self.ref_calls += 1
            sha = "a" * 40 if self.move_after_first and self.ref_calls > 1 else self.revision
            return {"ref": readback.intake.APPROVAL_BRANCH,
                    "object": {"type": "commit", "sha": sha}}
        if endpoint == f"{prefix}/git/commits/{self.revision}":
            return {"sha": self.revision, "tree": {"sha": self.tree_sha}}
        if endpoint == f"{prefix}/git/trees/{self.tree_sha}?recursive=1":
            return {"sha": self.tree_sha, "truncated": self.truncated,
                    "tree": [{"path": path, "type": "blob",
                              "mode": self.modes.get(path, "100644"),
                              "size": len(raw), "sha": git_sha(raw)}
                             for path, raw in self.files.items()]}
        if endpoint.startswith(f"{prefix}/git/blobs/"):
            selected = endpoint.removeprefix(f"{prefix}/git/blobs/")
            for raw in self.files.values():
                if git_sha(raw) == selected:
                    content = raw + b"x" if self.corrupt_blob else raw
                    return {"sha": selected, "encoding": "base64", "size": len(raw),
                            "content": base64.b64encode(content).decode()}
        raise ValueError(f"unexpected synthetic API request: {endpoint}")

    def read(self):
        return readback.read_current(self.record["pull_request"], MERGE, IMAGE,
                                     now=NOW, api=self.api)

    def test_current_pinned_record_policy_and_complete_evidence(self):
        snapshot = self.read()
        self.assertEqual(snapshot.branch_revision, self.revision)
        self.assertEqual(snapshot.record, self.files[f"{self.root}/record.json"])
        self.assertEqual(len(snapshot.evidence), 2)
        self.assertEqual(self.ref_calls, 2)
        self.assertEqual(readback.recheck_current(snapshot, self.record["pull_request"],
                         MERGE, IMAGE, now=NOW, api=self.api), snapshot)

    def test_missing_protection_moving_ref_and_truncated_tree_fail(self):
        self.protected = False
        with self.assertRaisesRegex(ValueError, "protected branch"):
            self.read()
        self.protected = True
        self.move_after_first = True
        self.ref_calls = 0
        with self.assertRaisesRegex(ValueError, "branch moved"):
            self.read()
        self.move_after_first = False
        self.ref_calls = 0
        self.truncated = True
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.read()

    def test_wrong_repository_and_duplicate_tree_path_fail(self):
        def wrong_repository(endpoint):
            value = self.api(endpoint)
            if endpoint == f"repos/{readback.intake.REPOSITORY}":
                value["id"] += 1
            return value
        with self.assertRaisesRegex(ValueError, "repository"):
            readback.read_current(self.record["pull_request"], MERGE, IMAGE,
                                  now=NOW, api=wrong_repository)

        def duplicate_tree(endpoint):
            value = self.api(endpoint)
            if "/git/trees/" in endpoint:
                value["tree"].append(copy.deepcopy(value["tree"][0]))
            return value
        with self.assertRaisesRegex(ValueError, "duplicate"):
            readback.read_current(self.record["pull_request"], MERGE, IMAGE,
                                  now=NOW, api=duplicate_tree)

    def test_wrong_subject_revocation_expiry_and_changed_bytes_fail(self):
        with self.assertRaisesRegex(ValueError, "file mode"):
            readback.read_current(self.record["pull_request"], MERGE,
                "sha256:" + "0" * 64, now=NOW, api=self.api)
        record_path = f"{self.root}/record.json"
        original = self.files[record_path]
        self.record["image"] = "sha256:" + "0" * 64
        self.files[record_path] = encode(self.record)
        with self.assertRaisesRegex(ValueError, "selected image"):
            self.read()
        self.record["image"] = IMAGE
        self.record["state"] = "revoked"
        self.files[record_path] = encode(self.record)
        with self.assertRaisesRegex(ValueError, "revoked"):
            self.read()
        self.files[record_path] = original
        with self.assertRaisesRegex(ValueError, "not current"):
            readback.read_current(self.record["pull_request"], MERGE, IMAGE,
                now=NOW + dt.timedelta(days=2), api=self.api)
        policy_path = f"{self.root}/policy.json"
        self.files[policy_path] += b" "
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            self.read()

    def test_symlink_blob_and_evidence_set_mutations_fail(self):
        policy_path = f"{self.root}/policy.json"
        self.modes[policy_path] = "120000"
        with self.assertRaisesRegex(ValueError, "file mode"):
            self.read()
        self.modes.clear()
        self.corrupt_blob = True
        with self.assertRaisesRegex(ValueError, "blob bytes"):
            self.read()
        self.corrupt_blob = False
        self.files[f"{self.root}/evidence/{'0' * 64}"] = b"extra"
        with self.assertRaisesRegex(ValueError, "member set"):
            self.read()
        del self.files[f"{self.root}/evidence/{'0' * 64}"]
        evidence_path = next(path for path in self.files if "/evidence/" in path)
        missing = self.files.pop(evidence_path)
        with self.assertRaisesRegex(ValueError, "file mode"):
            self.read()
        self.files[evidence_path] = missing
        self.files[evidence_path] += b"x"
        with self.assertRaisesRegex(ValueError, "evidence|blob"):
            self.read()

    def test_recheck_refuses_new_revision_or_revoked_record(self):
        snapshot = self.read()
        self.revision = "e" * 40
        with self.assertRaisesRegex(ValueError, "changed"):
            readback.recheck_current(snapshot, self.record["pull_request"],
                MERGE, IMAGE, now=NOW, api=self.api)
        self.revision = "d" * 40
        self.record["state"] = "revoked"
        self.files[f"{self.root}/record.json"] = encode(self.record)
        with self.assertRaisesRegex(ValueError, "revoked"):
            readback.recheck_current(snapshot, self.record["pull_request"],
                MERGE, IMAGE, now=NOW, api=self.api)

    def test_readback_is_absent_from_live_workflows(self):
        root = Path(__file__).resolve().parents[2]
        for workflow in (root / ".github/workflows").iterdir():
            if workflow.suffix not in {".yml", ".yaml"}:
                continue
            with self.subTest(workflow=workflow.name):
                self.assertNotIn("image_approval_readback", workflow.read_text())


if __name__ == "__main__":
    unittest.main()
