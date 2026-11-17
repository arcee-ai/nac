"""Exact-source candidate proof for two libssh2 corrections with 32-bit controls.

This validates reviewed source and package identity. It does not assert a
runtime differential in the installed amd64 ELF or authorize a disposition.
"""

import hashlib
import io
import json
import tarfile


SOURCE_SHA256 = "d9ec76cbe34db98eec3539fe2c899d26b0c837cb3eb466a56b0f109cabf658f7"
DEBIAN_SHA256 = "ee81e3ea0d65fdbc979c50f1433966d0139e33ac09242d7dc7c83567139126a7"
LIBSSH2_LOCK_SHA256 = "f6ba2a73736539e9d544459d690ea6c4d72c3354ced2a2535110ddd815200d0d"
PATCHES_SHA256 = "fa1edf4b3e93593eb350b5af3ed7bcb374dc109871868247393287b6df5aa3c7"
PAYLOAD_SHA256 = "57be6ff4f07a0595d5c51ce88650d7e68789ff666c9beda406fc3c04f87feced"
SOURCE_COMMIT = "a312b43325e3383c865a87bb1d26cb52e3292641"
SUBJECTS = {
    "CVE-2026-58050": {
        "ghsa": "GHSA-mf77-5hj2-98w9",
        "alias_sha256": "5b36ed35999e7a45d308083ac8f4c221ae55004e09083fcfb58bdc43ec418851",
        "commit": "34497525929b9a47f03dfb81887ac896202b7e12",
        "fix_sha256": "9cb033e07004a755675e2095eb7f05ebeaafa70b0920a1fdb8f6ad23498047d9",
        "applied_sha256": "e05eb89d9bfcc6dd93a769a9beb87b05eccd0a1ce801e8cf729ef0bd05fd2ef6",
        "source_file": "src/publickey.c",
        "final_sha256": "d5c7ea98aef3c057cad74e7f7c3471be41302a3fc19326620206ad16b814a54e",
        "coordinates": {
            ("apk:libssh2", "1.11.1-r12", "grype", ("CVE-2026-58050",)),
            ("upstream:libssh2/libssh2", "1.11.1", "grype-upstream", ("CVE-2026-58050",)),
        },
    },
    "CVE-2026-55200": {
        "ghsa": "GHSA-r8mh-x5qv-7gg2",
        "alias_sha256": "c20aa8fc43a5e6d28fa82587d8283277369cd9f26d1c0d2b8cb0dc645320d7cd",
        "commit": "97acf3dfda80c91c3a8c9f2372546301d4a1a7a8",
        "fix_sha256": "b5f1bdb38a072ae86f49a34eddc6e53b88aac0fe002846b3927faa0a26b2ed75",
        "applied_sha256": "2aea7cd9dde3a3b771ee26735a17c6a4257585b62840bc5223da576df8aaf735",
        "source_file": "src/transport.c",
        "final_sha256": "c9315507031a8caf0094b9fef1d07a8e517de919074f7cebb9dfd85aa64214fe",
        "coordinates": {
            ("upstream:libssh2/libssh2", "1.11.1", "grype-upstream", ("CVE-2026-55200",)),
            ("upstream-wolfi:libssh2", "1.11.1", "grype-upstream",
             ("CVE-2026-55200", "GHSA-r8mh-x5qv-7gg2")),
        },
    },
}
ROLES = {"official_alias", "official_fix", "applied_patch", "final_source",
         "release_archive", "debian_archive", "source_lock", "provenance"}


def require(ok, message):
    if not ok:
        raise ValueError(f"image applicability: pinned libssh2 source: {message}")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(value):
    return sha((json.dumps(value, sort_keys=True, separators=(",", ":"),
                           allow_nan=False) + "\n").encode())


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
        raise ValueError(f"image applicability: pinned libssh2 source: invalid {label} JSON") from error


def archive_member(raw, path, mode):
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode=mode) as archive:
            members = [member for member in archive if member.name == path]
            require(len(members) == 1 and members[0].isfile() and members[0].size <= 128 * 1024,
                    f"missing or duplicate {path}")
            return archive.extractfile(members[0]).read()
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ValueError(f"image applicability: pinned libssh2 source: invalid archive for {path}") from error


def guard_order(cve, raw):
    try:
        source = raw.decode("utf-8")
        if cve == "CVE-2026-58050":
            start = source.index("list[keys].num_attrs = _libssh2_ntohu32(")
            guard = source.index("if(list[keys].num_attrs > 1024)", start)
            allocation = source.index("list[keys].attrs =", start)
            require(start < guard < allocation and "LIBSSH2_ERROR_OUT_OF_BOUNDARY" in
                    source[guard:allocation] and "goto err_exit;" in source[guard:allocation],
                    "attribute cap does not guard allocation")
        else:
            arithmetic = source.index("total_num += p->packet_length")
            start = source.rfind("p->packet_length = _libssh2_ntohu32(block)", 0, arithmetic)
            guard = source.index("p->packet_length > LIBSSH2_PACKET_MAXPAYLOAD", start)
            allocation = source.index("p->payload = LIBSSH2_ALLOC(session, total_num)", start)
            require(0 <= start < guard < arithmetic < allocation and
                    "LIBSSH2_ERROR_OUT_OF_BOUNDARY" in source[guard:arithmetic],
                    "packet cap does not precede arithmetic and allocation")
    except (UnicodeDecodeError, ValueError) as error:
        raise ValueError("image applicability: pinned libssh2 source: missing source guard") from error


def validate(rule, record, evidence):
    finding = rule["finding"]
    aliases = finding["advisories"]
    require(aliases[0] in SUBJECTS, "ineligible CVE")
    cve, spec = aliases[0], SUBJECTS[aliases[0]]
    coordinate = (finding["package"], finding["version"], finding["source"], tuple(aliases))
    require(coordinate in spec["coordinates"] and "binding" in rule and "bindings" not in rule,
            "ineligible exact scanner coordinate or aliases")
    require(rule["disposition"] == "fixed" and record["proof"] == {
        "kind": "pinned-libssh2-fixed-source", "cve": cve, "upstream_commit": spec["commit"],
        "source_file": spec["source_file"]}, "invalid exact source proof")
    bound = rule["binding"]
    require(bound["package"] == finding["package"] and bound["installed_package"] == "apk:libssh2" and
            bound["package_version"] == "1.11.1-r12" and bound["upstream_version"] == "1.11.1" and
            bound["source_sha256"] == SOURCE_SHA256 and bound["patches_sha256"] == PATCHES_SHA256 and
            bound["payload_sha256"] == PAYLOAD_SHA256, "installed libssh2 bytes differ")
    roles = record["artifacts"]
    require(set(roles) == ROLES, "invalid exact artifact roles")
    for role, expected in (("official_alias", spec["alias_sha256"]),
                           ("official_fix", spec["fix_sha256"]),
                           ("applied_patch", spec["applied_sha256"]),
                           ("final_source", spec["final_sha256"]),
                           ("release_archive", SOURCE_SHA256),
                           ("debian_archive", DEBIAN_SHA256)):
        require(roles[role] == expected and sha(evidence[expected]) == expected,
                f"unrecognized {role} bytes")
    require(sha(evidence[roles["source_lock"]]) == roles["source_lock"],
            "tampered source lock bytes")
    alias = document(evidence[roles["official_alias"]], "GitHub advisory")
    require(isinstance(alias, dict) and alias.get("cve_id") == cve and
            alias.get("ghsa_id") == spec["ghsa"] and
            alias.get("html_url") == "https://github.com/advisories/" + spec["ghsa"] and
            alias.get("withdrawn_at") is None and
            isinstance(alias.get("identifiers"), list) and
            all(isinstance(item, dict) and isinstance(item.get("type"), str) and
                isinstance(item.get("value"), str) for item in alias["identifiers"]) and
            {(item["type"], item["value"]) for item in alias["identifiers"]} >=
            {("CVE", cve), ("GHSA", spec["ghsa"])}, "official advisory identity differs")
    fix = evidence[roles["official_fix"]]
    applied = evidence[roles["applied_patch"]]
    require(fix.startswith(("From " + spec["commit"] + " ").encode()) and
            ("a/" + spec["source_file"]).encode() in fix and
            spec["source_file"].encode() in applied,
            "official and applied correction differ from reviewed source")
    if cve == "CVE-2026-58050":
        require(archive_member(evidence[roles["debian_archive"]],
                               "debian/patches/CVE-2026-58050.patch", "r:xz") == applied,
                "applied correction is not in retained Debian archive")
    release_readme = archive_member(evidence[roles["release_archive"]],
                                    "libssh2-1.11.1/README", "r:gz")
    release_header = archive_member(evidence[roles["release_archive"]],
                                    "libssh2-1.11.1/include/libssh2.h", "r:gz")
    require(release_readme.startswith(b"libssh2 - SSH2 library\n") and
            b"Web site: https://libssh2.org/" in release_readme and
            b'#define LIBSSH2_VERSION "1.11.1"' in release_header,
            "release archive is not libssh2")
    guard_order(cve, evidence[roles["final_source"]])
    lock = document(evidence[roles["source_lock"]], "source lock")
    require(isinstance(lock, dict) and isinstance(lock.get("libssh2"), dict) and
            canonical_sha(lock["libssh2"]) == LIBSSH2_LOCK_SHA256 and
            lock["libssh2"].get("reviewed_source_files", {}).get(spec["source_file"]) ==
            spec["final_sha256"] and
            lock["libssh2"].get("version") == "1.11.1" and
            lock["libssh2"].get("package_version") == "1.11.1-r12" and
            lock["libssh2"].get("source_commit") == SOURCE_COMMIT,
            "source lock does not identify reviewed correction")
    provenance = document(evidence[roles["provenance"]], "provenance")
    require(isinstance(provenance, dict) and provenance.get("schema_version") == 1 and
            provenance.get("subject") == {key: bound[key] for key in
                                          ("image", "source_revision", "platform")} and
            provenance.get("application_profile_sha256") == bound["application_profile_sha256"] and
            provenance.get("source_lock_sha256") == canonical_sha(lock) and
            provenance.get("source_downloads", {}).get("libssh2.tar.gz") == {
                "url": "https://www.libssh2.org/download/libssh2-1.11.1.tar.gz",
                "sha256": SOURCE_SHA256} and
            provenance.get("source_downloads", {}).get("libssh2-debian.tar.xz", {}).get("sha256") ==
            DEBIAN_SHA256 and
            provenance.get("packages", {}).get("libssh2") == {
                "package_version": bound["package_version"], "upstream_version": bound["upstream_version"],
                "source_commit": SOURCE_COMMIT, "source_sha256": SOURCE_SHA256,
                "patches_sha256": PATCHES_SHA256, "payload_sha256": PAYLOAD_SHA256},
            "independent exact-image provenance differs")
    if cve == "CVE-2026-55200":
        require(provenance.get("source_downloads", {}).get("libssh2-supplier-55200.patch", {}).get("sha256") ==
                spec["applied_sha256"], "supplier correction differs from exact image")
