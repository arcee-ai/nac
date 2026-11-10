"""Complete raw accounting across applicability and the unchanged source policy."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import image_applicability as app
import image_applicability_gate as gate
from image_inventory import write_json
from test_image_applicability import fixture, encode, NOW


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.candidate = self.root / "candidate.json"
        self.trusted = self.root / "trusted.json"
        self.f = fixture()
        self.subject = self.f["scan_identity"]
        self.empty = encode({"schema_version": 1, "rules": []})
        self.candidate.write_bytes(self.empty)

    def evaluate(self, **kwargs):
        return gate.evaluate(self.f["findings"], trusted_path=self.trusted,
            candidate_path=self.candidate, observations=self.f["observations"],
            scan_identity=self.subject, now=NOW, **kwargs)

    def install_reviewed_fixture(self):
        raw = encode(self.f["record"])
        evidence = {**self.f["evidence"], app.digest(raw): raw}
        directory = self.root / "proof"
        directory.mkdir()
        for digest, contents in evidence.items():
            (directory / digest).write_bytes(contents)
        policy = encode({"schema_version": 1, "rules": self.f["rules"]})
        self.trusted.write_bytes(policy)
        self.candidate.write_bytes(policy)
        return directory

    def source(self):
        return {"blocking": copy.deepcopy(self.f["findings"]), "excepted": [], "reporting": []}

    def retain(self, receipt, source=None):
        source = source or self.source()
        write_json(self.root / "findings.json", self.f["findings"])
        write_json(self.root / "policy-result.json", source)
        return gate.retain_decision(self.root, source, receipt, self.subject)

    def test_missing_trusted_capability_admits_nothing_and_is_explicitly_inactive(self):
        receipt = self.evaluate()
        self.assertEqual(receipt["status"], "inactive")
        self.assertIsNone(receipt["policy_sha256"])
        self.assertEqual(receipt["dispositions"], [])
        self.assertEqual(self.retain(receipt)["blocking_indexes"], [0])
        self.assertEqual(gate.validated_decision(self.root, self.f["findings"], self.source(),
                         self.subject)["blocking_indexes"], [0])

    def test_missing_trust_cannot_bootstrap_candidate_rules_or_malformed_data(self):
        for raw in (encode({"schema_version": 1, "rules": self.f["rules"]}), b"{}", b"not-json"):
            self.candidate.write_bytes(raw)
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                self.evaluate()

    def test_legacy_absent_capability_retains_original_verdict(self):
        self.candidate.unlink()
        receipt = self.evaluate()
        self.assertEqual(receipt["reason"], "capability-not-configured")
        self.assertEqual(self.retain(receipt)["blocking_indexes"], [0])
        self.trusted.write_bytes(self.empty)
        with self.assertRaises(OSError):
            self.evaluate()

    def test_policy_symlinks_and_nonregular_inputs_are_rejected(self):
        self.candidate.unlink()
        target = self.root / "other-policy.json"
        target.write_bytes(self.empty)
        self.candidate.symlink_to(target)
        with self.assertRaises(OSError):
            self.evaluate()

    def test_trusted_empty_policy_is_verified_and_preserves_unknown_findings(self):
        self.trusted.write_bytes(self.empty)
        self.f["findings"][0]["severity"] = "Unknown"
        before = copy.deepcopy(self.f["findings"])
        receipt = self.evaluate()
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(self.retain(receipt)["blocking_indexes"], [0])
        self.assertEqual(self.f["findings"], before)

    def test_exact_reviewed_fixture_changes_decision_without_changing_any_raw_byte(self):
        directory = self.install_reviewed_fixture()
        receipt = self.evaluate(evidence_directory=directory)
        source = self.source()
        write_json(self.root / "findings.json", self.f["findings"])
        write_json(self.root / "policy-result.json", source)
        original = [(self.root / name).read_bytes() for name in ("findings.json", "policy-result.json")]
        result = gate.retain_decision(self.root, source, receipt, self.subject)
        self.assertEqual(result["blocking_indexes"], [])
        for name, raw in zip(("findings.json", "policy-result.json"), original):
            self.assertEqual((self.root / name).read_bytes(), raw)
        self.assertEqual(gate.validated_decision(self.root, self.f["findings"], source, self.subject), result)

    def test_changed_trusted_candidate_or_proof_cannot_pass(self):
        directory = self.install_reviewed_fixture()
        self.candidate.write_bytes(self.trusted.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "candidate changes"):
            self.evaluate(evidence_directory=directory)
        self.candidate.write_bytes(self.trusted.read_bytes())
        digest = next(iter(self.f["evidence"]))
        (directory / digest).write_bytes(b"altered")
        with self.assertRaises((ValueError, OSError)):
            self.evaluate(evidence_directory=directory)

    def test_evidence_digest_paths_reject_symlinks_and_missing_files(self):
        directory = self.install_reviewed_fixture()
        digest = next(iter(self.f["evidence"]))
        raw = (directory / digest).read_bytes()
        (directory / digest).unlink()
        with self.assertRaises(OSError):
            self.evaluate(evidence_directory=directory)
        target = self.root / "other-file"
        target.write_bytes(raw)
        (directory / digest).symlink_to(target)
        with self.assertRaises((ValueError, OSError)):
            self.evaluate(evidence_directory=directory)

    def test_duplicate_rows_aliases_and_source_exceptions_keep_exact_accounting(self):
        self.f["findings"] *= 2
        source = self.source()
        receipt = self.evaluate()
        self.assertEqual(gate.reconcile(self.f["findings"], source, receipt), [0, 1])
        source["excepted"] = [dict(source["blocking"].pop(), exception={"fixture": True})]
        self.assertEqual(gate.reconcile(self.f["findings"], source, receipt), [0])
        source["reporting"] = [source["blocking"].pop()]
        self.assertEqual(gate.reconcile(self.f["findings"], source, receipt), [])

    def test_partition_must_cover_every_row_once_with_real_integer_indexes(self):
        receipt = self.evaluate()
        for indexes in ([], [0, 0], [1], [True], [-1]):
            changed = {**receipt, "unresolved_indexes": indexes}
            with self.subTest(indexes=indexes), self.assertRaises(ValueError):
                gate.reconcile(self.f["findings"], self.source(), changed)
        changed = copy.deepcopy(receipt)
        changed["raw_findings"][0]["advisory"] = "CVE-OTHER"
        with self.assertRaises(ValueError):
            gate.reconcile(self.f["findings"], self.source(), changed)

    def test_missing_replaced_or_dropped_source_policy_rows_fail(self):
        receipt = self.evaluate()
        for source in ({"blocking": [], "excepted": [], "reporting": []},
                       {"blocking": [{"advisory": "CVE-OTHER"}], "excepted": [], "reporting": []},
                       {"blocking": [], "excepted": self.f["findings"], "reporting": []}):
            with self.subTest(source=source), self.assertRaises(ValueError):
                gate.reconcile(self.f["findings"], source, receipt)

    def test_changed_retained_input_and_inactive_admissions_fail_reporting(self):
        for name in ("findings.json", "policy-result.json", "applicability-result.json"):
            receipt = self.evaluate()
            self.retain(receipt)
            (self.root / name).write_text("{}")
            with self.subTest(name=name), self.assertRaises(ValueError):
                gate.validated_decision(self.root, self.f["findings"], self.source(), self.subject)
        receipt = self.evaluate()
        receipt["dispositions"] = [{"finding_index": 0, "rule_id": "fake", "disposition": "fixed",
                                    "rule_sha256": "c" * 64, "evidence_sha256": "d" * 64}]
        receipt["unresolved_indexes"] = []
        self.retain(receipt)
        with self.assertRaisesRegex(ValueError, "inactive applicability cannot admit"):
            gate.validated_decision(self.root, self.f["findings"], self.source(), self.subject)

    def test_wrong_source_image_or_effective_blocker_fails_reporting(self):
        receipt = self.evaluate()
        self.retain(receipt)
        for key, value in (("source_revision", "d" * 40), ("image", "sha256:" + "d" * 64)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                gate.validated_decision(self.root, self.f["findings"], self.source(), {**self.subject, key: value})
        decision = json.loads((self.root / "decision.json").read_text())
        decision["blocking_indexes"] = []
        write_json(self.root / "decision.json", decision)
        with self.assertRaises(ValueError):
            gate.validated_decision(self.root, self.f["findings"], self.source(), self.subject)


if __name__ == "__main__":
    unittest.main()
