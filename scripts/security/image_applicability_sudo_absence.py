"""Narrow, reviewed image-only absence proof for sudo's Kerberos auth flaw.

This validates frozen advisory and passive filesystem bytes. It does not infer
absence from the package name alone, inspect later mounts, or approve a rule.
"""

import hashlib
import json
from pathlib import PurePosixPath


CVE_SHA256 = "e2bfeed267be5f35e98831b887aa11cfa45aa46c93e2dfd9ba0195f90e1fd8cb"
NVD_SHA256 = "f573266b314d0f810d50ef041e998007b6c600dc16c5f2eb8bb5adfdedfd5ba6"
SOURCE_SHA256 = "fe90af8441ad9fa9b064b8e53077cefb782a96f8a68276b031dc54af1789ff0b"
SOURCE_COMMIT = "f5bee90a501da6c351b3db46c1ae837b033a714c"
PATCHES_SHA256 = "d7d40d2cb28701b932e6620eab78964d035a8bcabf4a8d150937d447f4f1f997"
SETUID_PATHS = {
    "/usr/bin/chage", "/usr/bin/chfn", "/usr/bin/chsh", "/usr/bin/gpasswd", "/usr/bin/passwd",
}
VOLUME_PATHS = ["/etc/nac", "/home/nac", "/repositories", "/run/nac", "/tmp", "/var/lib/nac"]
ARTIFACT_ROLES = {"official_cve", "official_nvd", "complete_filesystem", "complete_consumers",
                  "source_lock", "provenance"}
SCOPE = "final-underlying-image-filesystem"
PROFILE = "nac-curl-krb5-libssh2-filesystem-v2"
FILE_PROFILE = "nac-curl-krb5-filesystem-v1"


def require(ok, message):
    if not ok:
        raise ValueError(f"image applicability: sudo image absence: {message}")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def document(raw, label):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f"duplicate {label} key")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: require(False, f"nonfinite {label} value"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"image applicability: sudo image absence: invalid {label} JSON") from error


def official_subject(cve, nvd):
    require(cve.get("cveMetadata", {}).get("cveId") == "CVE-2007-3149", "wrong CVE record")
    descriptions = cve.get("containers", {}).get("cna", {}).get("descriptions", [])
    require(isinstance(descriptions, list) and any(
        item.get("lang") == "en" and item.get("value", "").startswith(
            "sudo, when linked with MIT Kerberos 5 (krb5), does not properly check")
        for item in descriptions if isinstance(item, dict)), "CVE does not identify sudo auth")
    require(nvd.get("totalResults") == 1 and isinstance(nvd.get("vulnerabilities"), list) and
            len(nvd["vulnerabilities"]) == 1, "ambiguous NVD record")
    entry = nvd["vulnerabilities"][0].get("cve", {})
    require(entry.get("id") == "CVE-2007-3149", "wrong NVD record")
    configurations = entry.get("configurations", [])
    require(isinstance(configurations, list) and any(
        node.get("operator") == "OR" and {match.get("criteria") for match in node.get("cpeMatch", [])
                                           if match.get("vulnerable") is True} >= {
            "cpe:2.3:a:mit:kerberos_5:-:*:*:*:*:*:*:*",
            "cpe:2.3:a:todd_miller:sudo:1.6.8_p12:*:*:*:*:*:*:*"}
        for group in configurations if isinstance(group, dict)
        for node in group.get("nodes", []) if isinstance(node, dict)),
        "NVD does not show the broad Kerberos/sudo CPE match")


def validate(rule, record, evidence):
    require(record["proof"] == {"kind": "sudo-kerberos-image-absence", "affected_application": "sudo",
                                  "scope": SCOPE}, "invalid exact proof scope")
    finding = rule["finding"]
    require(finding == {"package": "upstream:mit/kerberos_5", "version": "1.22.3",
                        "source": "grype-upstream", "advisories": ["CVE-2007-3149"]},
            "ineligible scanner coordinate or alias")
    require(rule["disposition"] == "not_affected" and "binding" in rule and "bindings" not in rule,
            "one installed Kerberos APK required")
    bound = rule["binding"]
    require(bound["package"] == finding["package"] and bound["installed_package"] == "apk:krb5-libs" and
            bound["package_version"] == "1.22.3-r0" and bound["upstream_version"] == "1.22.3" and
            bound["source_sha256"] == SOURCE_SHA256 and bound["patches_sha256"] == PATCHES_SHA256,
            "installed Kerberos source/patch subject differs")
    roles = record["artifacts"]
    require(set(roles) == ARTIFACT_ROLES, "invalid proof artifact roles")
    require(roles["official_cve"] == CVE_SHA256 and roles["official_nvd"] == NVD_SHA256,
            "unrecognized official advisory bytes")
    official_subject(document(evidence[roles["official_cve"]], "CVE"),
                     document(evidence[roles["official_nvd"]], "NVD"))
    filesystem = document(evidence[roles["complete_filesystem"]], "filesystem")
    consumers = document(evidence[roles["complete_consumers"]], "consumers")
    provenance = document(evidence[roles["provenance"]], "provenance")
    lock = document(evidence[roles["source_lock"]], "source lock")
    require(all(isinstance(item, dict) for item in (filesystem, consumers, provenance, lock)),
            "malformed profile or source lock")
    require(filesystem.get("schema_version") == consumers.get("schema_version") == 1 and
            filesystem.get("scope") == consumers.get("scope") == provenance.get("filesystem_scope") == SCOPE and
            filesystem.get("profile") == consumers.get("profile") == FILE_PROFILE and
            provenance.get("profile") == PROFILE,
            "profile is not the complete final image scope")
    entries = filesystem.get("entries")
    observed = consumers.get("entries")
    require(isinstance(entries, dict) and entries and isinstance(observed, dict) and
            consumers.get("named_applications", {}).get("sudo") == [],
            "sudo application or complete consumer inventory missing")
    require(all(isinstance(path, str) and isinstance(item, dict) for path, item in entries.items()),
            "malformed filesystem entries")
    named = {path for path, item in entries.items() if item.get("type") != "directory" and
             PurePosixPath(path).name.lower() in {"sudo", "sudoedit", "sudoreplay"}}
    require(not named, "sudo executable or link present in frozen filesystem")
    privileged = {path for path, item in entries.items() if item.get("type") in {"file", "hardlink"} and
                  isinstance(item.get("mode"), int) and item["mode"] & 0o6000}
    require(privileged == SETUID_PATHS and all(
        entries[path].get("uid") == 0 and entries[path].get("mode") == 0o4755 and
        observed.get(path, {}).get("kind") == "elf" and
        not {"libkrb5.so.3", "libgssapi_krb5.so.2"}.intersection(observed[path].get("needed", []))
        for path in privileged), "unexpected privileged executable or Kerberos consumer")
    subject = {key: bound[key] for key in ("image", "source_revision", "platform")}
    file_sha, consumer_sha = roles["complete_filesystem"], roles["complete_consumers"]
    require(provenance.get("schema_version") == 1 and provenance.get("subject") == subject and
            provenance.get("declared_volume_paths") == VOLUME_PATHS and
            provenance.get("filesystem_sha256") == file_sha and
            provenance.get("consumers_sha256") == consumer_sha and
            provenance.get("application_profile_sha256") == bound["application_profile_sha256"] and
            digest(canonical({"filesystem": file_sha, "consumers": consumer_sha,
                              "filesystem_scope": SCOPE, "declared_volume_paths": VOLUME_PATHS})) ==
            bound["application_profile_sha256"], "profile hash or image subject differs")
    require(provenance.get("source_lock_sha256") == digest(canonical(lock)) and
            lock.get("krb5", {}).get("version") == "1.22.3" and
            lock["krb5"].get("package_version") == "1.22.3-r0" and
            lock["krb5"].get("source_commit") == SOURCE_COMMIT and
            lock["krb5"].get("archive") == "krb5.tar.gz" and
            lock["krb5"].get("patches") == ["krb5-autoconf.patch"] and
            lock.get("downloads", {}).get("krb5.tar.gz", {}).get("sha256") == SOURCE_SHA256 and
            provenance.get("source_downloads", {}).get("krb5.tar.gz") ==
            lock["downloads"]["krb5.tar.gz"] and
            provenance.get("packages", {}).get("krb5-libs") == {
                "package_version": bound["package_version"], "upstream_version": bound["upstream_version"],
                "source_commit": SOURCE_COMMIT, "source_sha256": SOURCE_SHA256,
                "patches_sha256": PATCHES_SHA256, "payload_sha256": bound["payload_sha256"]},
            "Kerberos source lock or installed payload provenance differs")
