"""Synthetic controls for the narrow sudo/Kerberos image proof; no approval."""

import copy
import json
import unittest
from unittest import mock

import image_applicability as app
import image_applicability_sudo_absence as sudo
from test_image_applicability import encode, fixture, run


def fixture_sudo():
    f = fixture("not_affected")
    bound = f["rules"][0]["binding"]
    bound.update(package="upstream:mit/kerberos_5", installed_package="apk:krb5-libs",
                 package_version="1.22.3-r0", upstream_version="1.22.3",
                 source_sha256="a" * 64, patches_sha256="b" * 64,
                 payload_sha256="c" * 64)
    f["record"]["binding"] = copy.deepcopy(bound)
    f["observations"] = [{"binding": copy.deepcopy(bound), "observed_at": "2026-11-10T19:45:00Z"}]
    f["rules"][0]["finding"] = {"package": bound["package"], "version": "1.22.3",
                                "source": "grype-upstream", "advisories": ["CVE-2007-3149"]}
    f["findings"] = [{**f["findings"][0], "package": bound["package"], "version": "1.22.3",
                      "source": "grype-upstream", "advisory": "CVE-2007-3149"}]
    filesystem = {"schema_version": 1, "profile": sudo.FILE_PROFILE, "scope": sudo.SCOPE,
                  "entries": {path: {"type": "file", "mode": 0o4755, "uid": 0, "gid": 0,
                                    "size": 123, "sha256": "d" * 64} for path in sudo.SETUID_PATHS}}
    consumers = {"schema_version": 1, "profile": sudo.FILE_PROFILE, "scope": sudo.SCOPE,
                 "entries": {path: {"kind": "elf", "machine": "x86_64", "type": 3,
                                    "needed": ["libc.so.6"]} for path in sudo.SETUID_PATHS},
                 "named_applications": {"ftpd": [], "sudo": []}}
    lock = {"krb5": {"version": "1.22.3", "package_version": "1.22.3-r0",
                      "source_commit": sudo.SOURCE_COMMIT, "archive": "krb5.tar.gz",
                      "patches": ["krb5-autoconf.patch"]},
            "downloads": {"krb5.tar.gz": {"url": "https://example.invalid/krb5.tar.gz",
                                               "sha256": bound["source_sha256"]}}}
    cve = {"cveMetadata": {"cveId": "CVE-2007-3149"},
           "containers": {"cna": {"descriptions": [{"lang": "en", "value":
               "sudo, when linked with MIT Kerberos 5 (krb5), does not properly check authentication."}]}}}
    nvd = {"totalResults": 1, "vulnerabilities": [{"cve": {"id": "CVE-2007-3149",
        "configurations": [{"nodes": [{"operator": "OR", "cpeMatch": [
            {"vulnerable": True, "criteria": "cpe:2.3:a:mit:kerberos_5:-:*:*:*:*:*:*:*"},
            {"vulnerable": True, "criteria": "cpe:2.3:a:todd_miller:sudo:1.6.8_p12:*:*:*:*:*:*:*"}]}]}]}}]}
    provenance = {"schema_version": 1, "profile": sudo.PROFILE,
                  "subject": {key: bound[key] for key in ("image", "source_revision", "platform")},
                  "filesystem_scope": sudo.SCOPE, "declared_volume_paths": sudo.VOLUME_PATHS,
                  "source_lock_sha256": app.digest(sudo.canonical(lock)),
                  "source_downloads": {"krb5.tar.gz": lock["downloads"]["krb5.tar.gz"]},
                  "packages": {"krb5-libs": {"package_version": bound["package_version"],
                      "upstream_version": bound["upstream_version"],
                      "source_commit": sudo.SOURCE_COMMIT, "source_sha256": bound["source_sha256"],
                      "patches_sha256": bound["patches_sha256"],
                      "payload_sha256": bound["payload_sha256"]}}}
    artifacts = {"official_cve": encode(cve), "official_nvd": encode(nvd),
                 "complete_filesystem": sudo.canonical(filesystem),
                 "complete_consumers": sudo.canonical(consumers),
                 "source_lock": sudo.canonical(lock), "provenance": sudo.canonical(provenance)}
    f["record"]["proof"] = {"kind": "sudo-kerberos-image-absence",
                            "affected_application": "sudo", "scope": sudo.SCOPE}
    pins = {"CVE_SHA256": app.digest(artifacts["official_cve"]),
            "NVD_SHA256": app.digest(artifacts["official_nvd"]),
            "SOURCE_SHA256": bound["source_sha256"],
            "PATCHES_SHA256": bound["patches_sha256"]}
    rebake(f, artifacts)
    return f, artifacts, pins


def rebake(f, artifacts):
    filesystem_sha = app.digest(artifacts["complete_filesystem"])
    consumers_sha = app.digest(artifacts["complete_consumers"])
    provenance = json.loads(artifacts["provenance"])
    provenance["filesystem_sha256"] = filesystem_sha
    provenance["consumers_sha256"] = consumers_sha
    profile_sha = app.digest(sudo.canonical({"filesystem": filesystem_sha,
        "consumers": consumers_sha, "filesystem_scope": sudo.SCOPE,
        "declared_volume_paths": sudo.VOLUME_PATHS}))
    provenance["application_profile_sha256"] = profile_sha
    artifacts["provenance"] = sudo.canonical(provenance)
    for item in (f["rules"][0]["binding"], f["record"]["binding"],
                 f["observations"][0]["binding"]):
        item["application_profile_sha256"] = profile_sha
    f["record"]["artifacts"] = {role: app.digest(raw) for role, raw in artifacts.items()}
    f["evidence"] = {app.digest(raw): raw for raw in artifacts.values()}
    f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))


class SudoAbsenceTests(unittest.TestCase):
    def qualify(self, f, pins):
        with mock.patch.multiple(sudo, **pins):
            return run(f)

    def test_exact_subject_with_reviewed_post_build_policy_only(self):
        f, _, pins = fixture_sudo()
        result = self.qualify(f, pins)
        self.assertEqual(result["approval_mode"], "post-build")
        self.assertEqual(result["raw_findings"], f["findings"])
        self.assertEqual(result["dispositions"][0]["disposition"], "not_affected")
        baseline = encode({"schema_version": 1, "rules": f["rules"]})
        with mock.patch.multiple(sudo, **pins), self.assertRaises(ValueError):
            run(f, candidate=baseline)

    def test_wrong_coordinate_alias_binding_or_scope_fails(self):
        for key, value in (("package", "upstream-wolfi:krb5"),
                           ("version", "1.22.2"), ("source", "grype"),
                           ("advisories", ["CVE-2007-3149", "GHSA-other"])):
            f, _, pins = fixture_sudo()
            f["rules"][0]["finding"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.qualify(f, pins)
        f, _, pins = fixture_sudo()
        f["record"]["proof"]["scope"] = "mounted-runtime"
        f["rules"][0]["evidence_sha256"] = app.digest(encode(f["record"]))
        with self.assertRaises(ValueError):
            self.qualify(f, pins)
        f, _, pins = fixture_sudo()
        f["observations"][0]["binding"]["payload_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_named_sudo_or_renamed_privileged_binary_fails_even_if_rehashed(self):
        for path, mode in (("/usr/bin/sudo", 0o755), ("/usr/bin/renamed-sudo", 0o4755)):
            f, artifacts, pins = fixture_sudo()
            filesystem = json.loads(artifacts["complete_filesystem"])
            filesystem["entries"][path] = {"type": "file", "mode": mode, "uid": 0,
                                           "gid": 0, "size": 100, "sha256": "e" * 64}
            artifacts["complete_filesystem"] = sudo.canonical(filesystem)
            rebake(f, artifacts)
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.qualify(f, pins)
        f, artifacts, pins = fixture_sudo()
        consumers = json.loads(artifacts["complete_consumers"])
        consumers["named_applications"]["sudo"] = ["/usr/bin/sudo"]
        artifacts["complete_consumers"] = sudo.canonical(consumers)
        rebake(f, artifacts)
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_privileged_kerberos_consumer_or_volume_drift_fails(self):
        f, artifacts, pins = fixture_sudo()
        consumers = json.loads(artifacts["complete_consumers"])
        consumers["entries"]["/usr/bin/chage"]["needed"].append("libkrb5.so.3")
        artifacts["complete_consumers"] = sudo.canonical(consumers)
        rebake(f, artifacts)
        with self.assertRaises(ValueError):
            self.qualify(f, pins)
        f, artifacts, pins = fixture_sudo()
        provenance = json.loads(artifacts["provenance"])
        provenance["declared_volume_paths"] = ["/tmp"]
        artifacts["provenance"] = sudo.canonical(provenance)
        rebake(f, artifacts)
        with self.assertRaises(ValueError):
            self.qualify(f, pins)

    def test_official_subject_source_lock_and_profile_tampering_fail(self):
        for role, old, new in (("official_cve", b"sudo, when linked", b"krb5, when linked"),
                               ("official_nvd", b"todd_miller:sudo", b"mit:sudo"),
                               ("source_lock", b"1.22.3", b"1.22.2")):
            f, artifacts, pins = fixture_sudo()
            self.assertIn(old, artifacts[role])
            artifacts[role] = artifacts[role].replace(old, new, 1)
            rebake(f, artifacts)
            with self.subTest(role=role), self.assertRaises(ValueError):
                self.qualify(f, pins)
        f, artifacts, pins = fixture_sudo()
        provenance = json.loads(artifacts["provenance"])
        provenance["packages"]["krb5-libs"]["payload_sha256"] = "0" * 64
        artifacts["provenance"] = sudo.canonical(provenance)
        rebake(f, artifacts)
        with self.assertRaises(ValueError):
            self.qualify(f, pins)


if __name__ == "__main__":
    unittest.main()
