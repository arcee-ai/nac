"""Synthetic contract controls only; these are not production advisory evidence."""
import copy
import datetime as dt
import json
from pathlib import Path
import unittest

import image_applicability as app


NOW = dt.datetime(2026, 11, 10, 20, tzinfo=dt.timezone.utc)


def encode(value):
    return json.dumps(value, sort_keys=True).encode()


def fixture(disposition="fixed"):
    installed = {"image": "sha256:" + "a" * 64, "source_revision": "b" * 40,
                 "platform": "linux/amd64", "package": "apk:fixture-library",
                 "installed_package": "apk:fixture-library",
                 "package_version": "1.0.0-r2", "upstream_version": "1.0.0",
                 **{key: "c" * 64 for key in ("source_sha256", "patches_sha256",
                                             "payload_sha256", "application_profile_sha256")}}
    finding = {"advisory": "CVE-SYNTHETIC-1", "package": installed["package"],
               "version": installed["package_version"], "source": "synthetic-scanner",
               "severity": "High", "context": "managed-image", "fixed": []}
    artifact = b"synthetic control receipt; not production evidence"
    artifact_sha = app.digest(artifact)
    roles = ({"vulnerable_control", "fixed_control", "provenance"} if disposition == "fixed" else
             {"complete_filesystem", "complete_consumers", "provenance"})
    proof = ({"kind": "regression", "vulnerable_control": "failed-as-expected", "fixed_control": "passed"}
             if disposition == "fixed" else
             {"kind": "application-absence", "affected_applications": ["synthetic-ftpd", "synthetic-sudo"]})
    record = {"schema_version": 1, "rule_id": "synthetic-rule", "binding": installed,
              "collected_at": "2026-11-10T19:00:00Z", "proof": proof,
              "artifacts": {role: artifact_sha for role in roles}}
    rule = {"id": "synthetic-rule", "finding": {"package": finding["package"],
            "version": finding["version"], "source": finding["source"],
            "advisories": [finding["advisory"], "GHSA-synthetic-alias"]},
            "binding": installed, "disposition": disposition,
            "evidence_sha256": app.digest(encode(record)),
            "review": {"owner": "synthetic-author", "reviewer": "synthetic-reviewer",
                       "issue": "https://example.invalid/issues/1",
                       "review": "https://example.invalid/reviews/1",
                       "reviewed_at": "2026-11-10T19:30:00Z", "expires_at": "2026-11-11T19:30:00Z"}}
    return {"findings": [finding], "rules": [rule], "record": record,
            "evidence": {artifact_sha: artifact},
            "observations": [{"binding": copy.deepcopy(installed), "observed_at": "2026-11-10T19:45:00Z"}],
            "scan_identity": {key: installed[key] for key in ("image", "source_revision", "platform")}}


def run(f, *, now=NOW, candidate=None):
    record_bytes = encode(f["record"])
    evidence = {**f["evidence"], app.digest(record_bytes): record_bytes}
    raw = encode({"schema_version": 1, "rules": f["rules"]})
    return app.verify_applicability(f["findings"], trusted_policy=raw,
                                    candidate_policy=candidate or raw, evidence=evidence,
                                    observations=f["observations"], scan_identity=f["scan_identity"], now=now)


class ApplicabilityTests(unittest.TestCase):
    def test_empty_production_policy_preserves_every_raw_record(self):
        f = fixture()
        raw = Path(app.__file__).resolve().parents[2] / app.POLICY_PATH
        result = app.verify_applicability(f["findings"], trusted_policy=raw.read_bytes(),
            candidate_policy=raw.read_bytes(), evidence={}, observations=[],
            scan_identity=f["scan_identity"], now=NOW)
        self.assertEqual(result["raw_findings"], f["findings"])
        self.assertEqual(result["unresolved_indexes"], [0])
        self.assertEqual(result["dispositions"], [])
        self.assertEqual(json.loads(raw.read_bytes())["rules"], [])

    def test_fixed_and_absence_have_separate_dispositions_without_mutating_raw(self):
        for kind in ("fixed", "not_affected"):
            with self.subTest(kind=kind):
                f = fixture(kind)
                before = copy.deepcopy(f)
                result = run(f)
                self.assertEqual(f, before)
                self.assertEqual(result["raw_findings"], before["findings"])
                self.assertEqual(result["dispositions"][0]["disposition"], kind)
                self.assertEqual(result["unresolved_indexes"], [])
                result["raw_findings"][0]["fixed"].append("untrusted-mutation")
                self.assertEqual(f, before)

    def test_only_exact_explicit_aliases_source_package_and_version_match(self):
        f = fixture()
        alias = {**f["findings"][0], "advisory": "GHSA-synthetic-alias"}
        f["findings"].append(alias)
        for field, value in (("advisory", "CVE-NEW-ALIAS"), ("source", "another-scanner"),
                             ("package", "apk:another-library"), ("version", "1.0.1-r2")):
            f["findings"].append({**f["findings"][0], field: value})
        result = run(f)
        self.assertEqual([entry["finding_index"] for entry in result["dispositions"]], [0, 1])
        self.assertEqual(result["unresolved_indexes"], [2, 3, 4, 5])

    def test_old_vulnerable_bytes_changed_patch_source_profile_or_versions_fail(self):
        for key in ("payload_sha256", "patches_sha256", "source_sha256", "application_profile_sha256",
                    "package_version", "upstream_version", "installed_package"):
            with self.subTest(key=key):
                f = fixture()
                f["observations"][0]["binding"][key] = (
                    "d" * 64 if key.endswith("sha256") else
                    "apk:another-library" if key == "installed_package" else "0.9.9")
                with self.assertRaisesRegex(ValueError, "independently verified observation"):
                    run(f)

    def test_wrong_scanned_image_source_or_platform_fails(self):
        for key, value in (("image", "sha256:" + "d" * 64), ("source_revision", "d" * 40),
                           ("platform", "linux/arm64")):
            f = fixture()
            f["scan_identity"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                run(f)

    def test_empty_policy_still_rejects_invalid_image_source_or_platform(self):
        for key, value in (("image", "fixture:latest"), ("source_revision", "shortsha"),
                           ("platform", "linux/arm64")):
            f = fixture()
            f["rules"] = []
            f["observations"] = []
            f["scan_identity"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                run(f)

    def test_upstream_report_coordinate_preserves_installed_apk_identity(self):
        for package in ("upstream:fixture/library", "upstream-wolfi:fixture-library"):
            f = fixture()
            f["findings"][0]["package"] = package
            f["rules"][0]["finding"]["package"] = package
            f["rules"][0]["binding"]["package"] = package
            f["observations"][0]["binding"]["package"] = package
            f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
            with self.subTest(package=package):
                self.assertEqual(run(f)["dispositions"][0]["rule_id"], "synthetic-rule")

    def test_shared_upstream_coordinate_cannot_clear_one_of_two_installed_apks(self):
        f = fixture()
        coordinate = "upstream:haxx/curl"
        f["findings"][0]["package"] = coordinate
        f["rules"][0]["finding"]["package"] = coordinate
        f["rules"][0]["binding"]["package"] = coordinate
        f["observations"][0]["binding"]["package"] = coordinate
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        sibling = copy.deepcopy(f["observations"][0])
        sibling["binding"]["installed_package"] = "apk:libcurl-openssl4"
        sibling["binding"]["payload_sha256"] = "d" * 64
        f["observations"].append(sibling)
        with self.assertRaisesRegex(ValueError, "aggregate installed-payload proof"):
            run(f)
        # The actual package coordinates remain independently reviewable.
        f["findings"][0]["package"] = "apk:fixture-library"
        f["rules"][0]["finding"]["package"] = "apk:fixture-library"
        f["rules"][0]["binding"]["package"] = "apk:fixture-library"
        f["observations"][0]["binding"]["package"] = "apk:fixture-library"
        f["observations"][1]["binding"]["package"] = "apk:libcurl-openssl4"
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        self.assertEqual(run(f)["dispositions"][0]["rule_id"], "synthetic-rule")

    def test_absence_evidence_cannot_survive_introduced_consumer_or_executable(self):
        for role in ("complete_filesystem", "complete_consumers"):
            f = fixture("not_affected")
            f["record"]["artifacts"][role] = "d" * 64
            f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
            with self.subTest(role=role), self.assertRaisesRegex(ValueError, "missing/tampered proof artifact"):
                run(f)

    def test_candidate_cannot_authorize_itself_even_with_valid_synthetic_evidence(self):
        f = fixture()
        with self.assertRaisesRegex(ValueError, "differs from trusted policy"):
            run(f, candidate=encode({"schema_version": 1, "rules": []}))
        with self.assertRaisesRegex(ValueError, "differs from trusted policy"):
            run(f, candidate=encode({"schema_version": 1, "rules": f["rules"]}) + b"\n")

    def test_missing_and_tampered_evidence_fail_closed(self):
        for change in ("missing", "tampered", "record"):
            f = fixture()
            if change == "missing":
                f["evidence"].clear()
            elif change == "tampered":
                f["evidence"] = {key: b"tampered" for key in f["evidence"]}
            else:
                f["record"]["binding"]["patches_sha256"] = "d" * 64
            with self.subTest(change=change), self.assertRaises(ValueError):
                run(f)

    def test_stale_future_or_postreview_evidence_fails(self):
        for value in ("2026-11-09T19:00:00Z", "2026-11-10T21:00:00Z", "2026-11-10T19:31:00Z"):
            f = fixture()
            f["record"]["collected_at"] = value
            f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
            with self.subTest(value=value), self.assertRaises(ValueError):
                run(f)

    def test_observation_missing_duplicate_stale_or_future_fails(self):
        for value in ([], ["duplicate"], "2026-11-09T19:45:00Z", "2026-11-10T21:00:00Z"):
            f = fixture()
            if value == []:
                f["observations"] = []
            elif value == ["duplicate"]:
                f["observations"] *= 2
            else:
                f["observations"][0]["observed_at"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                run(f)

    def test_expired_future_overlong_self_review_and_missing_accountability_fail(self):
        for key, value in (("expires_at", "2026-11-10T20:00:00Z"),
                           ("reviewed_at", "2026-11-10T21:00:00Z"),
                           ("expires_at", "2027-11-10T20:00:00Z"),
                           ("reviewer", "synthetic-author"), ("owner", ""),
                           ("review", "http://example.invalid/review/1")):
            f = fixture()
            f["rules"][0]["review"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                run(f)

    def test_unknown_or_ambiguous_rules_fail_even_without_matching_findings(self):
        for change in ("unknown", "duplicate", "overlap", "wildcard", "version", "malformed"):
            f = fixture()
            if change == "unknown":
                f["rules"][0]["unknown"] = True
            elif change == "duplicate":
                f["rules"] *= 2
            elif change == "overlap":
                another = copy.deepcopy(f["rules"][0])
                another["id"] = "another"
                f["rules"].append(another)
            elif change == "wildcard":
                f["rules"][0]["finding"]["advisories"] = ["CVE-*"]
            elif change == "version":
                f["rules"][0]["finding"]["version"] = "99.9.9"
            else:
                f["rules"][0]["binding"]["source_sha256"] = "bad"
            f["findings"] = []
            with self.subTest(change=change), self.assertRaises(ValueError):
                run(f)

    def test_failed_or_incomplete_controls_cannot_be_admitted(self):
        for change in ("vulnerable", "fixed", "artifact", "kind"):
            f = fixture()
            if change == "artifact":
                del f["record"]["artifacts"]["vulnerable_control"]
            elif change == "kind":
                f["record"]["proof"]["kind"] = "provenance-only"
            else:
                f["record"]["proof"][change + "_control"] = "skipped"
            f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
            with self.subTest(change=change), self.assertRaises(ValueError):
                run(f)

    def test_duplicate_json_keys_and_nonfinite_values_fail(self):
        for raw in (b'{"schema_version":1,"schema_version":1,"rules":[]}',
                    b'{"schema_version":NaN,"rules":[]}', b'not json', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                app.policy(raw, NOW)

    def test_raw_unknown_fields_and_duplicate_rows_are_preserved(self):
        f = fixture()
        f["findings"][0]["scanner_details"] = {"raw": [1, 2, 3]}
        f["findings"] *= 2
        result = run(f)
        self.assertEqual(result["raw_findings"], f["findings"])
        self.assertEqual([x["finding_index"] for x in result["dispositions"]], [0, 1])


if __name__ == "__main__":
    unittest.main()
