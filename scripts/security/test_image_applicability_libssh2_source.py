"""Synthetic source-proof controls; no production image is approved here."""

import copy
import io
import json
import tarfile
import unittest
from unittest import mock

import image_applicability as app
import image_applicability_libssh2_source as source
from test_image_applicability import encode, fixture, run


def archive(files, mode):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode=mode) as tar:
        for name, raw in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(raw)
            tar.addfile(member, io.BytesIO(raw))
    return output.getvalue()


def source_text(cve):
    if cve == "CVE-2026-58050":
        return (b"list[keys].num_attrs = _libssh2_ntohu32(p);\n"
                b"if(list[keys].num_attrs > 1024) {\n"
                b"LIBSSH2_ERROR_OUT_OF_BOUNDARY; goto err_exit;\n}\n"
                b"list[keys].attrs = LIBSSH2_ALLOC(session, n);\n")
    return (b"p->packet_length = _libssh2_ntohu32(block);\n"
            b"if(p->packet_length > LIBSSH2_PACKET_MAXPAYLOAD) {\n"
            b"return LIBSSH2_ERROR_OUT_OF_BOUNDARY;\n}\n"
            b"total_num += p->packet_length;\n"
            b"p->payload = LIBSSH2_ALLOC(session, total_num);\n")


def subject_fixture(cve="CVE-2026-58050", coordinate=None):
    f = fixture("fixed")
    spec = source.SUBJECTS[cve]
    coordinate = coordinate or sorted(spec["coordinates"])[0]
    package, version, scan_source, aliases = coordinate
    bound = f["rules"][0]["binding"]
    release = archive({"libssh2-1.11.1/README":
                       b"libssh2 - SSH2 library\nWeb site: https://libssh2.org/\n",
                       "libssh2-1.11.1/include/libssh2.h":
                       b'#define LIBSSH2_VERSION "1.11.1"\n'}, "w:gz")
    applied = (b"--- a/" + spec["source_file"].encode() + b"\n+++ b/" +
               spec["source_file"].encode() + b"\n+" + source_text(cve))
    debian = archive({"debian/patches/CVE-2026-58050.patch": applied}, "w:xz")
    final = source_text(cve)
    fix = ("From " + spec["commit"] + " Mon Sep 17 00:00:00 2001\n"
           "diff --git a/" + spec["source_file"] + " b/" + spec["source_file"] + "\n").encode()
    alias = encode({"ghsa_id": spec["ghsa"], "cve_id": cve,
                    "html_url": "https://github.com/advisories/" + spec["ghsa"],
                    "withdrawn_at": None,
                    "identifiers": [{"type": "GHSA", "value": spec["ghsa"]},
                                    {"type": "CVE", "value": cve}]})
    lock = encode({"krb5": {"version": "1.22.2"},
                   "libssh2": {"version": "1.11.1", "package_version": "1.11.1-r12",
                               "source_commit": "a" * 40,
                               "reviewed_source_files": {spec["source_file"]: app.digest(final)}}})
    bound.update(package=package, installed_package="apk:libssh2", package_version="1.11.1-r12",
                 upstream_version="1.11.1", source_sha256=app.digest(release),
                 patches_sha256="d" * 64, payload_sha256="e" * 64,
                 application_profile_sha256="f" * 64)
    f["record"]["binding"] = copy.deepcopy(bound)
    f["observations"] = [{"binding": copy.deepcopy(bound), "observed_at": "2026-11-10T19:45:00Z"}]
    f["rules"][0]["finding"] = {"package": package, "version": version,
                                "source": scan_source, "advisories": list(aliases)}
    f["findings"] = [{**f["findings"][0], "package": package, "version": version,
                      "source": scan_source, "advisory": advisory} for advisory in aliases]
    f["record"]["proof"] = {"kind": "pinned-libssh2-fixed-source", "cve": cve,
                            "upstream_commit": spec["commit"], "source_file": spec["source_file"]}
    downloads = {"libssh2.tar.gz": {"url": "https://www.libssh2.org/download/libssh2-1.11.1.tar.gz",
                                    "sha256": app.digest(release)},
                 "libssh2-debian.tar.xz": {"sha256": app.digest(debian)}}
    if cve == "CVE-2026-55200":
        downloads["libssh2-supplier-55200.patch"] = {"sha256": app.digest(applied)}
    provenance = encode({"schema_version": 1,
                         "subject": {key: bound[key] for key in ("image", "source_revision", "platform")},
                         "application_profile_sha256": bound["application_profile_sha256"],
                         "source_lock_sha256": source.canonical_sha(json.loads(lock)),
                         "source_downloads": downloads,
                         "packages": {"libssh2": {
                             "package_version": bound["package_version"],
                             "upstream_version": bound["upstream_version"],
                             "source_commit": "a" * 40, "source_sha256": app.digest(release),
                             "patches_sha256": bound["patches_sha256"],
                             "payload_sha256": bound["payload_sha256"]}}})
    artifacts = {"official_alias": alias, "official_fix": fix, "applied_patch": applied,
                 "final_source": final, "release_archive": release, "debian_archive": debian,
                 "source_lock": lock, "provenance": provenance}
    f["record"]["artifacts"] = {key: app.digest(raw) for key, raw in artifacts.items()}
    f["evidence"] = {app.digest(raw): raw for raw in artifacts.values()}
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
    pins = {"SOURCE_SHA256": app.digest(release), "DEBIAN_SHA256": app.digest(debian),
            "LIBSSH2_LOCK_SHA256": source.canonical_sha(json.loads(lock)["libssh2"]),
            "PATCHES_SHA256": "d" * 64,
            "PAYLOAD_SHA256": "e" * 64, "SOURCE_COMMIT": "a" * 40,
            "SUBJECTS": {cve: {**spec, "alias_sha256": app.digest(alias),
                                "fix_sha256": app.digest(fix),
                                "applied_sha256": app.digest(applied),
                                "final_sha256": app.digest(final)}}}
    return f, pins


def replace_artifact(f, role, raw):
    old = f["record"]["artifacts"][role]
    f["evidence"].pop(old)
    f["record"]["artifacts"][role] = app.digest(raw)
    f["evidence"][app.digest(raw)] = raw
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))


class PinnedLibssh2SourceTests(unittest.TestCase):
    def qualify(self, f, pins):
        with mock.patch.multiple(source, **pins):
            return run(f)

    def test_only_four_exact_coordinates_cover_five_raw_rows(self):
        for cve, spec in source.SUBJECTS.items():
            for coordinate in spec["coordinates"]:
                with self.subTest(cve=cve, coordinate=coordinate):
                    f, pins = subject_fixture(cve, coordinate)
                    result = self.qualify(f, pins)
                    self.assertEqual(result["raw_findings"], f["findings"])
                    self.assertEqual([x["finding_index"] for x in result["dispositions"]],
                                     list(range(len(coordinate[3]))))
                    self.assertEqual(result["approval_mode"], "post-build")

    def test_wrong_coordinate_alias_proof_and_observation_fail(self):
        for field, value in (("package", "upstream-wolfi:other"),
                             ("version", "1.11.2"), ("source", "other-scanner"),
                             ("advisories", ["CVE-2026-58050", "GHSA-extra"])):
            with self.subTest(field=field):
                f, pins = subject_fixture()
                f["rules"][0]["finding"][field] = value
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)
        f, pins = subject_fixture()
        f["record"]["proof"]["upstream_commit"] = "0" * 40
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            self.qualify(f, pins)
        f, pins = subject_fixture()
        f["observations"][0]["binding"]["payload_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_tampered_alias_fix_source_patch_lock_and_provenance_fail(self):
        for role in ("official_alias", "official_fix", "applied_patch", "final_source",
                     "release_archive", "debian_archive", "source_lock", "provenance"):
            with self.subTest(role=role):
                f, pins = subject_fixture()
                raw = f["evidence"][f["record"]["artifacts"][role]]
                replace_artifact(f, role, raw + b"changed")
                with self.assertRaises(ValueError):
                    self.qualify(f, pins)

    def test_rebound_final_source_without_guard_still_fails(self):
        for cve in source.SUBJECTS:
            with self.subTest(cve=cve):
                f, pins = subject_fixture(cve)
                raw = f["evidence"][f["record"]["artifacts"]["final_source"]]
                if cve == "CVE-2026-58050":
                    changed = raw.replace(b"if(list[keys].num_attrs > 1024)",
                                          b"if(list[keys].num_attrs > 0xffffffff)")
                else:
                    changed = raw.replace(b"p->packet_length > LIBSSH2_PACKET_MAXPAYLOAD",
                                          b"p->packet_length > 0xffffffff")
                replace_artifact(f, "final_source", changed)
                pins["SUBJECTS"][cve]["final_sha256"] = app.digest(changed)
                lock = json.loads(f["evidence"][f["record"]["artifacts"]["source_lock"]])
                lock["libssh2"]["reviewed_source_files"][source.SUBJECTS[cve]["source_file"]] = app.digest(changed)
                replace_artifact(f, "source_lock", encode(lock))
                pins["LIBSSH2_LOCK_SHA256"] = source.canonical_sha(lock["libssh2"])
                provenance = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
                provenance["source_lock_sha256"] = source.canonical_sha(lock)
                replace_artifact(f, "provenance", encode(provenance))
                with self.assertRaisesRegex(ValueError, "missing source guard"):
                    self.qualify(f, pins)

    def test_unrelated_lock_change_is_accepted_but_libssh2_change_fails(self):
        f, pins = subject_fixture()
        lock = json.loads(f["evidence"][f["record"]["artifacts"]["source_lock"]])
        lock["krb5"]["version"] = "1.22.3"
        replace_artifact(f, "source_lock", encode(lock))
        provenance = json.loads(f["evidence"][f["record"]["artifacts"]["provenance"]])
        provenance["source_lock_sha256"] = source.canonical_sha(lock)
        replace_artifact(f, "provenance", encode(provenance))
        self.assertEqual(len(self.qualify(f, pins)["dispositions"]), 1)

        lock["libssh2"]["unexpected_change"] = "new patch or recipe"
        replace_artifact(f, "source_lock", encode(lock))
        provenance["source_lock_sha256"] = source.canonical_sha(lock)
        replace_artifact(f, "provenance", encode(provenance))
        with self.assertRaisesRegex(ValueError, "source lock does not identify reviewed correction"):
            self.qualify(f, pins)

    def test_full_packet_guard_must_be_after_last_length_read(self):
        first_path_guard = (b"p->packet_length = _libssh2_ntohu32(block);\n"
                            b"if(p->packet_length > LIBSSH2_PACKET_MAXPAYLOAD)\n"
                            b"return LIBSSH2_ERROR_OUT_OF_BOUNDARY;\n")
        full_packet_without_guard = (b"p->packet_length = _libssh2_ntohu32(block);\n"
                                     b"total_num += p->packet_length;\n"
                                     b"p->payload = LIBSSH2_ALLOC(session, total_num);\n")
        with self.assertRaisesRegex(ValueError, "missing source guard"):
            source.guard_order("CVE-2026-55200", first_path_guard + full_packet_without_guard)

    def test_candidate_self_authorization_still_fails(self):
        f, pins = subject_fixture()
        with mock.patch.multiple(source, **pins), self.assertRaises(ValueError):
            run(f, candidate=encode({"schema_version": 1, "rules": f["rules"]}))


if __name__ == "__main__":
    unittest.main()
