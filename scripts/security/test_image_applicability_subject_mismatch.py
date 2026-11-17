"""Synthetic wrong-project controls; no test grants a production image approval."""

import copy
import io
import json
import tarfile
import unittest
from unittest import mock

import image_applicability as app
import image_applicability_subject_mismatch as subject
from test_image_applicability import encode, fixture, run


def archive(readme=b"libssh2 - SSH2 library\nWeb site: https://libssh2.org/\n"):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for path, raw in (("libssh2-1.11.1/README", readme),
                          ("libssh2-1.11.1/include/libssh2.h", b'#define LIBSSH2_VERSION "1.11.1"\n')):
            member = tarfile.TarInfo(path)
            member.size = len(raw)
            tar.addfile(member, io.BytesIO(raw))
    return output.getvalue()


def subject_fixture(cve="CVE-2025-5318"):
    f = fixture("not_affected")
    ghsa = subject.SUBJECTS[cve]["ghsa"]
    bound = f["rules"][0]["binding"]
    source_bytes = archive()
    source_sha = app.digest(source_bytes)
    bound.update(package="upstream-wolfi:libssh2", installed_package="apk:libssh2",
                 package_version="1.11.1-r12", upstream_version="1.11.1",
                 source_sha256=source_sha, patches_sha256="d" * 64,
                 payload_sha256="e" * 64, application_profile_sha256="f" * 64)
    f["record"]["binding"] = copy.deepcopy(bound)
    f["observations"] = [{"binding": copy.deepcopy(bound), "observed_at": "2026-11-10T19:45:00Z"}]
    f["rules"][0]["finding"] = {"package": bound["package"], "version": "1.11.1",
                                "source": "grype-upstream", "advisories": [cve, ghsa]}
    f["findings"] = [{**f["findings"][0], "package": bound["package"], "version": "1.11.1",
                      "source": "grype-upstream", "advisory": advisory} for advisory in (cve, ghsa)]
    advisory = (f"== CVE ID#:     {cve}\n== Versions:    libssh < 0.11.2\n"
                f"== Summary:     {subject.SUBJECTS[cve]['subject_marker']}\n").encode()
    alias = encode({"ghsa_id": ghsa, "cve_id": cve,
                    "html_url": "https://github.com/advisories/" + ghsa,
                    "withdrawn_at": None,
                    "identifiers": [{"type": "GHSA", "value": ghsa},
                                    {"type": "CVE", "value": cve}]})
    provenance = encode({"schema_version": 1,
                         "subject": {key: bound[key] for key in ("image", "source_revision", "platform")},
                         "application_profile_sha256": bound["application_profile_sha256"],
                         "source_downloads": {"libssh2.tar.gz": {
                             "url": "https://www.libssh2.org/download/libssh2-1.11.1.tar.gz",
                             "sha256": source_sha}},
                         "packages": {"libssh2": {
                             "package_version": bound["package_version"],
                             "upstream_version": bound["upstream_version"],
                             "source_commit": "a" * 40, "source_sha256": source_sha,
                             "patches_sha256": bound["patches_sha256"],
                             "payload_sha256": bound["payload_sha256"]}}})
    artifacts = {"official_advisory": advisory, "official_alias": alias,
                 "libssh2_release_archive": source_bytes, "provenance": provenance}
    f["record"]["proof"] = {"kind": "official-subject-mismatch",
                            "advisory_project": "libssh", "installed_project": "libssh2"}
    f["record"]["artifacts"] = {role: app.digest(raw) for role, raw in artifacts.items()}
    f["evidence"] = {app.digest(raw): raw for raw in artifacts.values()}
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
    pins = {"SOURCE_SHA256": source_sha, "SOURCE_COMMIT": "a" * 40,
            "PATCHES_SHA256": "d" * 64,
            "SUBJECTS": {cve: {**subject.SUBJECTS[cve],
                               "advisory_sha256": app.digest(advisory),
                               "alias_sha256": app.digest(alias)}}}
    return f, pins


def replace_artifact(f, role, raw):
    old = f["record"]["artifacts"][role]
    f["evidence"].pop(old)
    digest = app.digest(raw)
    f["record"]["artifacts"][role] = digest
    f["evidence"][digest] = raw
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))


class OfficialSubjectMismatchTests(unittest.TestCase):
    def qualify(self, f, pins):
        with mock.patch.multiple(subject, **pins):
            return run(f)

    def test_all_three_exact_cve_ghsa_pairs_are_individually_bounded(self):
        for cve in subject.SUBJECTS:
            with self.subTest(cve=cve):
                f, pins = subject_fixture(cve)
                result = self.qualify(f, pins)
                self.assertEqual(result["raw_findings"], f["findings"])
                self.assertEqual([entry["finding_index"] for entry in result["dispositions"]], [0, 1])
                self.assertEqual(result["approval_mode"], "post-build")

    def test_wrong_coordinate_alias_project_and_version_fail(self):
        for field, value in (("package", "upstream:libssh2/libssh2"),
                             ("source", "grype"), ("version", "1.11.2"),
                             ("advisories", ["CVE-2025-5318"]),
                             ("advisories", ["CVE-2025-5318", "GHSA-other"])):
            with self.subTest(field=field):
                f, pins = subject_fixture()
                f["rules"][0]["finding"][field] = value
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)
        f, pins = subject_fixture()
        f["record"]["proof"]["installed_project"] = "libssh"
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_same_name_package_spoof_and_changed_source_patch_payload_fail(self):
        for field, value in (("installed_package", "apk:libssh"),
                             ("package_version", "0.11.1-r12"),
                             ("source_sha256", "0" * 64),
                             ("patches_sha256", "0" * 64),
                             ("payload_sha256", "0" * 64),
                             ("application_profile_sha256", "0" * 64)):
            with self.subTest(field=field):
                f, pins = subject_fixture()
                f["observations"][0]["binding"][field] = value
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)

    def test_wrong_image_source_and_missing_independent_observation_fail(self):
        for field, value in (("image", "sha256:" + "0" * 64),
                             ("source_revision", "0" * 40), ("platform", "linux/arm64")):
            with self.subTest(field=field):
                f, pins = subject_fixture()
                f["scan_identity"][field] = value
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)
        f, pins = subject_fixture()
        f["observations"] = []
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_official_subject_alias_and_source_bytes_fail_when_changed(self):
        for role, old, new in (("official_advisory", b"libssh <", b"libssh2 <"),
                               ("official_alias", b"CVE-2025-5318", b"CVE-2025-5319"),
                               ("libssh2_release_archive", b"\x1f\x8b", b"not-gzip")):
            with self.subTest(role=role):
                f, pins = subject_fixture()
                raw = f["evidence"][f["record"]["artifacts"][role]]
                self.assertIn(old, raw)
                replace_artifact(f, role, raw.replace(old, new, 1))
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)
        f, pins = subject_fixture()
        altered = archive(readme=b"libssh - SSH2 library\nWeb site: https://libssh.org/\n")
        replace_artifact(f, "libssh2_release_archive", altered)
        altered_sha = app.digest(altered)
        pins["SOURCE_SHA256"] = altered_sha
        f["rules"][0]["binding"]["source_sha256"] = altered_sha
        f["record"]["binding"]["source_sha256"] = altered_sha
        f["observations"][0]["binding"]["source_sha256"] = altered_sha
        provenance = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
        provenance["source_downloads"]["libssh2.tar.gz"]["sha256"] = altered_sha
        provenance["packages"]["libssh2"]["source_sha256"] = altered_sha
        replace_artifact(f, "provenance", encode(provenance))
        with self.assertRaisesRegex(ValueError, "not pinned libssh2 subject"):
            self.qualify(f, pins)

    def test_provenance_changes_and_candidate_self_approval_fail(self):
        for field, value in (("source_commit", "0" * 40),
                             ("patches_sha256", "0" * 64),
                             ("payload_sha256", "0" * 64)):
            with self.subTest(field=field):
                f, pins = subject_fixture()
                raw = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
                raw["packages"]["libssh2"][field] = value
                replace_artifact(f, "provenance", encode(raw))
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)
        f, pins = subject_fixture()
        candidate = encode({"schema_version": 1, "rules": f["rules"]})
        with mock.patch.multiple(subject, **pins), self.assertRaises(ValueError):
            run(f, candidate=candidate)

    def test_existing_application_absence_contract_remains_compatible(self):
        f = fixture("not_affected")
        self.assertEqual(run(f)["dispositions"][0]["disposition"], "not_affected")


if __name__ == "__main__":
    unittest.main()
