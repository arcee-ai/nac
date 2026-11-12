"""Synthetic curl release controls; never production advisory evidence."""

import copy
import datetime as dt
import difflib
import io
import json
import tarfile
import unittest
from unittest import mock

import image_applicability as app
import image_applicability_curl_release as curl
from test_image_applicability import aggregate_fixture, encode, run


OLD = """static CURLcode multi_done(struct Curl_easy *data,
int premature) {
  Curl_conn_ev_data_done(data, premature);
  multi_schedule_pending(data->multi);
  Curl_req_done(&data->req, data, premature);
  Curl_detach_connection(data);
  Curl_cpool_return(data, conn, multi_done_locked, &mdctx, pnow);
}
/* flush the netrc cache */
"""
FIXED = """static CURLcode multi_done(struct Curl_easy *data,
int premature) {
  Curl_req_done(&data->req, data, premature);
  Curl_conn_ev_data_done(data, premature);
  Curl_detach_connection(data);
  Curl_cpool_return(data, conn, multi_done_locked, &mdctx, pnow);
  if(data->multi)
    multi_schedule_pending(data->multi);
}
/* flush the netrc cache */
"""


def fixture():
    f = aggregate_fixture()
    f["rules"][0]["finding"].update(
        package="upstream-wolfi:curl", version="8.23.0", source="grype-upstream",
        advisories=[curl.CVE, curl.GHSA])
    f["findings"] = [{**f["findings"][0], "package": "upstream-wolfi:curl",
                      "version": "8.23.0", "source": "grype-upstream",
                      "advisory": advisory} for advisory in (curl.CVE, curl.GHSA)]
    advisory = {
        "id": "CURL-CVE-2026-92392", "aliases": [curl.CVE],
        "database_specific": {"package": "curl", "URL": "https://curl.se/docs/CVE-2026-92392.json",
                              "last_affected": "8.22.0"},
        "affected": [{"ranges": [
            {"type": "SEMVER", "events": [{"fixed": "8.23.0"}]},
            {"type": "GIT", "repo": "https://github.com/curl/curl.git",
             "events": [{"fixed": curl.FIX_COMMIT}]}]}]}
    alias = {"ghsa_id": curl.GHSA, "cve_id": curl.CVE,
             "html_url": "https://github.com/advisories/" + curl.GHSA,
             "withdrawn_at": None,
             "identifiers": [{"type": "GHSA", "value": curl.GHSA},
                             {"type": "CVE", "value": curl.CVE}],
             "references": ["https://curl.se/docs/CVE-2026-92392.json"]}
    patch = "".join(difflib.unified_diff(
        OLD.splitlines(keepends=True), FIXED.splitlines(keepends=True),
        fromfile="a/lib/multi.c", tofile="b/lib/multi.c")).encode()
    patch = ("From " + curl.FIX_COMMIT + " synthetic\n").encode() + patch
    archive_io = io.BytesIO()
    with tarfile.open(fileobj=archive_io, mode="w:xz") as tar:
        raw = FIXED.encode()
        member = tarfile.TarInfo("curl-8.23.0/lib/multi.c")
        member.size = len(raw)
        tar.addfile(member, io.BytesIO(raw))
    archive = archive_io.getvalue()
    source_sha = app.digest(archive)
    patches_sha = app.digest(b"{}\n")
    bindings = f["rules"][0]["bindings"]
    bindings[0]["installed_package"] = "apk:curl"
    for item in bindings:
        item.update(package_version="8.23.0-r2", upstream_version="8.23.0",
                    source_sha256=source_sha, patches_sha256=patches_sha,
                    application_profile_sha256="e" * 64)
    f["record"]["bindings"] = copy.deepcopy(bindings)
    f["observations"] = [{"binding": copy.deepcopy(item), "observed_at": "2026-11-10T19:45:00Z"}
                         for item in bindings]
    provenance = {
        "schema_version": 1,
        "subject": {key: bindings[0][key] for key in ("image", "source_revision", "platform")},
        "application_profile_sha256": "e" * 64,
        "source_downloads": {"curl.tar.xz": {
            "url": "https://curl.se/download/curl-8.23.0.tar.xz", "sha256": source_sha}},
        "packages": {item["installed_package"].removeprefix("apk:"): {
            "package_version": item["package_version"], "upstream_version": item["upstream_version"],
            "source_commit": curl.PACKAGE_SOURCE_COMMIT, "source_sha256": source_sha,
            "patches_sha256": patches_sha, "payload_sha256": item["payload_sha256"]}
                     for item in bindings}}
    artifacts = {"official_advisory": encode(advisory), "official_alias": encode(alias),
                 "official_fix": patch, "release_archive": archive,
                 "provenance": encode(provenance)}
    f["record"]["proof"] = {"kind": "official-curl-fixed-release",
                            "fixed_version": "8.23.0", "fixed_commit": curl.FIX_COMMIT}
    f["record"]["artifacts"] = {role: app.digest(raw) for role, raw in artifacts.items()}
    f["evidence"] = {app.digest(raw): raw for raw in artifacts.values()}
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
    pins = {"ADVISORY_SHA256": app.digest(artifacts["official_advisory"]),
            "ALIAS_SHA256": app.digest(artifacts["official_alias"]),
            "FIX_SHA256": app.digest(patch), "ARCHIVE_SHA256": source_sha,
            "FIXED_SOURCE_SHA256": app.digest(FIXED.encode()),
            "REVERSED_SOURCE_SHA256": app.digest(OLD.encode()),
            "EMPTY_PATCH_SET_SHA256": patches_sha}
    return f, pins


def replace_artifact(f, role, raw):
    digest = app.digest(raw)
    f["record"]["artifacts"][role] = digest
    f["evidence"][digest] = raw
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))


class CurlOfficialReleaseTests(unittest.TestCase):
    def setUp(self):
        self.f, pins = fixture()
        self.patches = [mock.patch.object(curl, name, value) for name, value in pins.items()]
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_exact_cve_and_ghsa_receive_separate_reviewed_dispositions(self):
        result = run(self.f)
        self.assertEqual([item["finding_index"] for item in result["dispositions"]], [0, 1])
        self.assertEqual(result["approval_mode"], "post-build")
        self.assertEqual(result["raw_findings"], self.f["findings"])

    def test_wrong_coordinate_alias_version_and_source_fail(self):
        for field, value in (("package", "upstream:haxx/curl"), ("source", "grype"),
                             ("version", "8.22.0"), ("advisories", [curl.CVE]),
                             ("advisories", [curl.CVE, "GHSA-new-alias"])):
            with self.subTest(field=field, value=value):
                f = copy.deepcopy(self.f)
                f["rules"][0]["finding"][field] = value
                with self.assertRaises(ValueError):
                    run(f)

    def test_missing_or_changed_either_installed_payload_fails(self):
        for index in (0, 1):
            with self.subTest(index=index):
                f = copy.deepcopy(self.f)
                f["observations"].pop(index)
                with self.assertRaises(ValueError):
                    run(f)
                f = copy.deepcopy(self.f)
                f["observations"][index]["binding"]["payload_sha256"] = "f" * 64
                with self.assertRaises(ValueError):
                    run(f)

    def test_wrong_image_source_profile_recipe_and_release_binding_fail(self):
        for field, value in (("image", "sha256:" + "f" * 64), ("source_revision", "f" * 40),
                             ("application_profile_sha256", "f" * 64),
                             ("source_sha256", "f" * 64), ("patches_sha256", "f" * 64),
                             ("package_version", "8.23.0-r3")):
            with self.subTest(field=field):
                f = copy.deepcopy(self.f)
                f["rules"][0]["bindings"][0][field] = value
                with self.assertRaises(ValueError):
                    run(f)

    def test_missing_or_tampered_official_artifact_fails(self):
        for role in curl.ARTIFACT_ROLES:
            with self.subTest(role=role):
                f = copy.deepcopy(self.f)
                f["evidence"].pop(f["record"]["artifacts"][role])
                with self.assertRaises(ValueError):
                    run(f)
                f = copy.deepcopy(self.f)
                f["evidence"][f["record"]["artifacts"][role]] = b"tampered"
                with self.assertRaises(ValueError):
                    run(f)

    def test_rebound_official_claims_and_provenance_fail(self):
        for role, field, value in (("official_advisory", "aliases", ["CVE-other"]),
                                   ("official_alias", "cve_id", "CVE-other"),
                                   ("provenance", "application_profile_sha256", "f" * 64)):
            with self.subTest(role=role):
                f = copy.deepcopy(self.f)
                raw = json.loads(f["evidence"][f["record"]["artifacts"][role]])
                raw[field] = value
                replace_artifact(f, role, encode(raw))
                with self.assertRaises(ValueError):
                    run(f)
        for package in ("curl", "libcurl-openssl4"):
            f = copy.deepcopy(self.f)
            raw = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
            raw["packages"][package]["source_commit"] = curl.FIX_COMMIT
            replace_artifact(f, "provenance", encode(raw))
            with self.subTest(package=package), self.assertRaises(ValueError):
                run(f)
            f = copy.deepcopy(self.f)
            raw = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
            raw["packages"][package]["payload_sha256"] = "f" * 64
            replace_artifact(f, "provenance", encode(raw))
            with self.subTest(package=package, field="payload"), self.assertRaises(ValueError):
                run(f)

    def test_rebound_fixed_version_commit_and_source_order_fail(self):
        for role, original, replacement in (
            ("official_advisory", b'"fixed": "8.23.0"', b'"fixed": "8.24.0"'),
            ("official_advisory", curl.FIX_COMMIT.encode(), b"f" * 40),
            ("official_fix", b"Curl_req_done", b"Curl_req_late"),
            ("release_archive", b"\xfd7zXZ", b"invalid-archive")):
            with self.subTest(role=role, original=original):
                f = copy.deepcopy(self.f)
                raw = f["evidence"][f["record"]["artifacts"][role]]
                self.assertIn(original, raw)
                replace_artifact(f, role, raw.replace(original, replacement, 1))
                with self.assertRaises(ValueError):
                    run(f)
        f = copy.deepcopy(self.f)
        f["record"]["proof"]["fixed_commit"] = curl.PACKAGE_SOURCE_COMMIT
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            run(f)

    def test_wrong_reversed_control_fails_even_with_rebound_artifact_pins(self):
        f, pins = fixture()
        # Swap in a release archive with the pre-fix order, and pin its bytes
        # as though a reviewer had accepted them. The semantic check still fails.
        archive_io = io.BytesIO()
        with tarfile.open(fileobj=archive_io, mode="w:xz") as tar:
            raw = OLD.encode()
            member = tarfile.TarInfo("curl-8.23.0/lib/multi.c")
            member.size = len(raw)
            tar.addfile(member, io.BytesIO(raw))
        archive = archive_io.getvalue()
        replace_artifact(f, "release_archive", archive)
        for item in f["rules"][0]["bindings"]:
            item["source_sha256"] = app.digest(archive)
        f["record"]["bindings"] = copy.deepcopy(f["rules"][0]["bindings"])
        f["observations"] = [{"binding": copy.deepcopy(item), "observed_at": "2026-11-10T19:45:00Z"}
                             for item in f["rules"][0]["bindings"]]
        raw = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
        raw["source_downloads"]["curl.tar.xz"]["sha256"] = app.digest(archive)
        for item in raw["packages"].values():
            item["source_sha256"] = app.digest(archive)
        replace_artifact(f, "provenance", encode(raw))
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with mock.patch.object(curl, "ARCHIVE_SHA256", app.digest(archive)), \
             mock.patch.object(curl, "FIXED_SOURCE_SHA256", app.digest(OLD.encode())):
            with self.assertRaisesRegex(ValueError, "fixed order"):
                run(f)

    def test_fixed_order_is_not_accepted_as_unqualified_regression(self):
        f = copy.deepcopy(self.f)
        f["record"]["proof"] = {"kind": "regression", "vulnerable_control": "failed-as-expected",
                                "fixed_control": "passed"}
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            run(f)

    def test_stale_evidence_and_candidate_self_approval_fail(self):
        f = copy.deepcopy(self.f)
        f["record"]["collected_at"] = "2026-11-09T19:00:00Z"
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            run(f)
        f = copy.deepcopy(self.f)
        candidate = encode({"schema_version": 2, "rules": f["rules"]})
        with self.assertRaises(ValueError):
            run(f, candidate=candidate)
        f = copy.deepcopy(self.f)
        baseline = encode({"schema_version": 1, "rules": []})
        record_bytes = encode(f["record"])
        result = app.verify_applicability(
            f["findings"], trusted_policy=baseline, candidate_policy=baseline,
            evidence={**f["evidence"], app.digest(record_bytes): record_bytes},
            observations=f["observations"], scan_identity=f["scan_identity"],
            now=dt.datetime(2026, 11, 10, 20, tzinfo=dt.timezone.utc))
        self.assertEqual(result["dispositions"], [])
        self.assertEqual(result["unresolved_indexes"], [0, 1])


if __name__ == "__main__":
    unittest.main()
