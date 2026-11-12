"""Narrow official-release proof for the two curl 8.23.0 scanner aliases.

This checks fixed source and its exact patch reversal. It is not a runtime UAF
regression and never grants a disposition without post-build human approval.
"""

import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import tempfile


CVE = "CVE-2026-92392"
GHSA = "GHSA-7jvw-75gf-2h34"
FIX_COMMIT = "8b0744af5b1b631da5b938ca31c3f9895ad5a321"
PACKAGE_SOURCE_COMMIT = "3163ec065643ba20709f190111f42c3e1fe95273"
ADVISORY_SHA256 = "c963a79877295c47b1dc65a108a2f4b3850b6019bc6f661692c1dc3f33130576"
ALIAS_SHA256 = "0fb4780850d69c50ac48af662d2b573f09d0a2dc3163c6d52c379aaa4b62e629"
FIX_SHA256 = "6f6d9a0dc69501c6e52f8841f2e9cbd843027a5cec1856d54e1de8799be88292"
ARCHIVE_SHA256 = "8dadd7d2536a314f982ad05a651b713f426bf7d02cc2c76cffb9796f2218e6c5"
FIXED_SOURCE_SHA256 = "515ac0f1295a3c0c74d59e08059e7a6a4195bc1fe3fcbc5a7c58846149979a8a"
REVERSED_SOURCE_SHA256 = "618a889e8f9268350239c05d58a3ff9af927fe0cf19e9be3c9436e73556344d3"
EMPTY_PATCH_SET_SHA256 = "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356"
ARTIFACT_ROLES = {"official_advisory", "official_alias", "official_fix", "release_archive", "provenance"}


def require(ok, message):
    if not ok:
        raise ValueError(f"image applicability: curl official release: {message}")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


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
        raise ValueError(f"image applicability: curl official release: invalid {label} JSON") from error


def corrected_order(source):
    try:
        body = source[source.index("static CURLcode multi_done("):
                      source.index("/* flush the netrc cache */")]
        calls = ("Curl_req_done(&data->req, data, premature)",
                 "Curl_conn_ev_data_done(data, premature)",
                 "Curl_detach_connection(data)",
                 "Curl_cpool_return(data, conn, multi_done_locked, &mdctx, pnow)",
                 "multi_schedule_pending(data->multi)")
        if any(body.count(call) != 1 for call in calls):
            return False
        positions = [body.index(call) for call in calls]
        return (positions == sorted(positions) and
                re.search(r"if\s*\(data->multi\)\s*multi_schedule_pending",
                          body[positions[3]:positions[4] + len(calls[4])]) is not None)
    except ValueError:
        return False


def fixed_source(archive, patch):
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:xz") as tar:
            members = [member for member in tar if member.name == "curl-8.23.0/lib/multi.c"]
            require(len(members) == 1 and members[0].isfile() and members[0].size <= 1024 * 1024,
                    "missing exact release multi.c")
            source = tar.extractfile(members[0]).read()
    except (tarfile.TarError, EOFError, OSError) as error:
        raise ValueError("image applicability: curl official release: invalid release archive") from error
    require(sha(source) == FIXED_SOURCE_SHA256 and corrected_order(source.decode("utf-8")),
            "release source lacks pinned fixed order")
    with tempfile.TemporaryDirectory(prefix="curl-official-release-") as root:
        path = pathlib.Path(root, "lib", "multi.c")
        path.parent.mkdir()
        path.write_bytes(source)
        patch_path = pathlib.Path(root, "official-fix.patch")
        patch_path.write_bytes(patch)
        try:
            subprocess.run(["patch", "-R", "--batch", "--fuzz=0", "-p1", "-i", str(patch_path)],
                           cwd=root, check=True, capture_output=True, timeout=20)
        except (FileNotFoundError, subprocess.SubprocessError) as error:
            raise ValueError("image applicability: curl official release: exact patch reversal failed") from error
        reversed_source = path.read_bytes()
    require(sha(reversed_source) == REVERSED_SOURCE_SHA256 and
            not corrected_order(reversed_source.decode("utf-8")),
            "patch reversal did not restore pinned old order")


def validate(rule, record, evidence):
    proof = record["proof"]
    require(isinstance(proof, dict) and proof == {
        "kind": "official-curl-fixed-release", "fixed_version": "8.23.0", "fixed_commit": FIX_COMMIT},
        "invalid exact fixed-release proof")
    finding = rule["finding"]
    require(finding == {"package": "upstream-wolfi:curl", "version": "8.23.0",
                        "source": "grype-upstream", "advisories": [CVE, GHSA]},
            "ineligible scanner coordinate or aliases")
    bindings = rule.get("bindings")
    require(isinstance(bindings, list) and len(bindings) == 2 and
            [item["installed_package"] for item in bindings] == ["apk:curl", "apk:libcurl-openssl4"],
            "both curl APKs require aggregate binding")
    for item in bindings:
        require(item["package"] == finding["package"] and item["package_version"] == "8.23.0-r2" and
                item["upstream_version"] == "8.23.0" and item["source_sha256"] == ARCHIVE_SHA256 and
                item["patches_sha256"] == EMPTY_PATCH_SET_SHA256,
                "installed package differs from pinned curl release/recipe")
    require(bindings[0]["payload_sha256"] != bindings[1]["payload_sha256"],
            "curl and libcurl require distinct payload commitments")
    roles = record["artifacts"]
    require(set(roles) == ARTIFACT_ROLES, "invalid official release artifact roles")
    for role, expected in (("official_advisory", ADVISORY_SHA256), ("official_alias", ALIAS_SHA256),
                           ("official_fix", FIX_SHA256), ("release_archive", ARCHIVE_SHA256)):
        require(roles[role] == expected and sha(evidence[expected]) == expected,
                f"unrecognized {role} bytes")
    advisory = document(evidence[ADVISORY_SHA256], "curl advisory")
    require(advisory.get("id") == "CURL-CVE-2026-92392" and advisory.get("aliases") == [CVE] and
            advisory.get("database_specific", {}).get("package") == "curl" and
            advisory.get("database_specific", {}).get("URL") == "https://curl.se/docs/CVE-2026-92392.json" and
            advisory.get("database_specific", {}).get("last_affected") == "8.22.0",
            "official advisory identity or affected range differs")
    ranges = [span for affected in advisory.get("affected", []) for span in affected.get("ranges", [])]
    require(any(span.get("type") == "SEMVER" and {"fixed": "8.23.0"} in span.get("events", [])
                for span in ranges) and
            any(span.get("type") == "GIT" and span.get("repo") == "https://github.com/curl/curl.git" and
                {"fixed": FIX_COMMIT} in span.get("events", []) for span in ranges),
            "official fixed version or commit differs")
    alias = document(evidence[ALIAS_SHA256], "GitHub alias")
    require(alias.get("ghsa_id") == GHSA and alias.get("cve_id") == CVE and
            alias.get("html_url") == "https://github.com/advisories/" + GHSA and
            alias.get("withdrawn_at") is None and
            {tuple(sorted(item.items())) for item in alias.get("identifiers", [])} >= {
                (("type", "GHSA"), ("value", GHSA)), (("type", "CVE"), ("value", CVE))} and
            "https://curl.se/docs/CVE-2026-92392.json" in alias.get("references", []),
            "official GHSA/CVE alias bridge differs")
    patch = evidence[FIX_SHA256]
    require(patch.startswith(("From " + FIX_COMMIT + " ").encode()), "official fix commit differs")
    fixed_source(evidence[ARCHIVE_SHA256], patch)
    provenance = document(evidence[roles["provenance"]], "provenance")
    require(provenance.get("schema_version") == 1 and
            provenance.get("subject") == {key: bindings[0][key] for key in
                                          ("image", "source_revision", "platform")} and
            provenance.get("application_profile_sha256") == bindings[0]["application_profile_sha256"] ==
            bindings[1]["application_profile_sha256"] and
            provenance.get("source_downloads", {}).get("curl.tar.xz") == {
                "url": "https://curl.se/download/curl-8.23.0.tar.xz", "sha256": ARCHIVE_SHA256},
            "provenance subject, profile or source download differs")
    packages = provenance.get("packages", {})
    for item in bindings:
        name = item["installed_package"].removeprefix("apk:")
        require(packages.get(name) == {
            "package_version": item["package_version"], "upstream_version": item["upstream_version"],
            "source_commit": PACKAGE_SOURCE_COMMIT, "source_sha256": ARCHIVE_SHA256,
            "patches_sha256": item["patches_sha256"], "payload_sha256": item["payload_sha256"]},
            f"installed {name} provenance differs")
