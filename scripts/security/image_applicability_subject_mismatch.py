"""Narrow wrong-project proof for three libssh advisories matched to libssh2.

This checks official libssh advisory/alias identity against the exact libssh2
source and installed payload provenance. It never creates a disposition without
the separately authenticated, independently reviewed post-build approval.
"""

import hashlib
import io
import json
import re
import tarfile


SOURCE_SHA256 = "d9ec76cbe34db98eec3539fe2c899d26b0c837cb3eb466a56b0f109cabf658f7"
SOURCE_COMMIT = "a312b43325e3383c865a87bb1d26cb52e3292641"
PATCHES_SHA256 = "fa1edf4b3e93593eb350b5af3ed7bcb374dc109871868247393287b6df5aa3c7"
SUBJECTS = {
    "CVE-2025-5318": {
        "ghsa": "GHSA-98qw-prqm-9f4p",
        "advisory_sha256": "45120b1452fcc3df676f382b29d2c819e06b0acb7ace72f509c4ae2ac281b9e2",
        "alias_sha256": "f5fe2a5bbb7cf12c0c46a34fb1b90dcf09d4a9ade0536fb653fde4f72323a19f",
        "subject_marker": "sftp_handle() (sftpserver)",
    },
    "CVE-2025-5987": {
        "ghsa": "GHSA-3pvj-q7qj-89fg",
        "advisory_sha256": "e368569f56a9825744150db8a59319cba49804e7db9a7ba306856ee95926355a",
        "alias_sha256": "41fe1139a44ff47f5b17d6436fbee0f9219ea2ac3a1700b519905294f4b47dfc",
        "subject_marker": "chacha20_poly1305_set_key()",
    },
    "CVE-2025-14821": {
        "ghsa": "GHSA-5jf9-8f86-jhvw",
        "advisory_sha256": "3dde3be6b8a6507047f13cee6fb73bbbb1a2acfb91009485b675b4ad061a56db",
        "alias_sha256": "06aca88cae739f08c5ac0cd2d1c029947c4ac1f28842f9738273cc974f9aeaea",
        "subject_marker": "C:\\etc directory on Windows",
    },
}
ARTIFACT_ROLES = {"official_advisory", "official_alias", "libssh2_release_archive", "provenance"}


def require(ok, message):
    if not ok:
        raise ValueError(f"image applicability: official subject mismatch: {message}")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def document(raw, label):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, f"duplicate {label} key")
            value[key] = item
        return value

    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: require(False, f"nonfinite {label} value"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"image applicability: official subject mismatch: invalid {label} JSON") from error


def source_identity(raw):
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            wanted = {"libssh2-1.11.1/README", "libssh2-1.11.1/include/libssh2.h"}
            members = [member for member in archive if member.name in wanted]
            require(len(members) == 2 and {member.name for member in members} == wanted and
                    all(member.isfile() and member.size <= 128 * 1024
                                               for member in members), "missing official source identity")
            contents = {member.name: archive.extractfile(member).read() for member in members}
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ValueError("image applicability: official subject mismatch: invalid libssh2 archive") from error
    require(contents["libssh2-1.11.1/README"].startswith(b"libssh2 - SSH2 library\n") and
            b"Web site: https://libssh2.org/" in contents["libssh2-1.11.1/README"] and
            b'#define LIBSSH2_VERSION "1.11.1"' in contents["libssh2-1.11.1/include/libssh2.h"],
            "release archive is not pinned libssh2 subject")


def validate(rule, record, evidence):
    proof = record["proof"]
    require(isinstance(proof, dict) and proof == {
        "kind": "official-subject-mismatch", "advisory_project": "libssh",
        "installed_project": "libssh2"}, "invalid exact subject proof")
    finding = rule["finding"]
    aliases = finding["advisories"]
    require(finding["package"] == "upstream-wolfi:libssh2" and
            finding["version"] == "1.11.1" and finding["source"] == "grype-upstream" and
            len(aliases) == 2 and aliases[0] in SUBJECTS and
            aliases[1] == SUBJECTS[aliases[0]]["ghsa"], "ineligible exact scanner coordinate or aliases")
    subject = SUBJECTS[aliases[0]]
    require("binding" in rule and "bindings" not in rule and "binding" in record,
            "subject mismatch requires one installed APK")
    bound = rule["binding"]
    require(bound["package"] == finding["package"] and
            bound["installed_package"] == "apk:libssh2" and
            bound["package_version"] == "1.11.1-r12" and
            bound["upstream_version"] == "1.11.1" and
            bound["source_sha256"] == SOURCE_SHA256 and
            bound["patches_sha256"] == PATCHES_SHA256,
            "installed package is not pinned libssh2 source/patch subject")
    roles = record["artifacts"]
    require(set(roles) == ARTIFACT_ROLES, "invalid subject proof artifact roles")
    for role, expected in (("official_advisory", subject["advisory_sha256"]),
                           ("official_alias", subject["alias_sha256"]),
                           ("libssh2_release_archive", SOURCE_SHA256)):
        require(roles[role] == expected and sha(evidence[expected]) == expected,
                f"unrecognized {role} bytes")
    try:
        advisory = evidence[roles["official_advisory"]].decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("image applicability: official subject mismatch: invalid advisory text") from error
    require(f"== CVE ID#:     {aliases[0]}" in advisory and
            re.search(r"== Versions:\s+libssh\b", advisory) is not None and
            "libssh2" not in advisory.lower() and subject["subject_marker"] in advisory,
            "official advisory does not identify the distinct libssh project")
    alias = document(evidence[roles["official_alias"]], "GitHub alias")
    require(isinstance(alias, dict), "malformed official alias")
    identifiers = alias.get("identifiers", [])
    require(isinstance(identifiers, list) and all(
        isinstance(item, dict) and isinstance(item.get("type"), str) and
        isinstance(item.get("value"), str) for item in identifiers), "malformed official alias identifiers")
    pairs = {(item["type"], item["value"]) for item in identifiers}
    require(alias.get("ghsa_id") == aliases[1] and alias.get("cve_id") == aliases[0] and
            alias.get("html_url") == "https://github.com/advisories/" + aliases[1] and
            alias.get("withdrawn_at") is None and
            pairs >= {("GHSA", aliases[1]), ("CVE", aliases[0])},
            "official alias does not bind exact CVE/GHSA pair")
    source_identity(evidence[roles["libssh2_release_archive"]])
    provenance = document(evidence[roles["provenance"]], "provenance")
    require(isinstance(provenance, dict) and isinstance(provenance.get("source_downloads"), dict) and
            isinstance(provenance.get("packages"), dict), "malformed independent provenance")
    require(provenance.get("schema_version") == 1 and
            provenance.get("subject") == {key: bound[key] for key in
                                          ("image", "source_revision", "platform")} and
            provenance.get("application_profile_sha256") == bound["application_profile_sha256"] and
            provenance.get("source_downloads", {}).get("libssh2.tar.gz") == {
                "url": "https://www.libssh2.org/download/libssh2-1.11.1.tar.gz",
                "sha256": SOURCE_SHA256} and
            provenance.get("packages", {}).get("libssh2") == {
                "package_version": bound["package_version"],
                "upstream_version": bound["upstream_version"],
                "source_commit": SOURCE_COMMIT,
                "source_sha256": SOURCE_SHA256,
                "patches_sha256": PATCHES_SHA256,
                "payload_sha256": bound["payload_sha256"]},
            "independent package provenance differs from reviewed libssh2 subject")
