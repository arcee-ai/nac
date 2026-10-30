"""Passive integrity checks for source-built runtime packages; never waives findings."""
import json
from pathlib import PurePosixPath
import re

from image_inventory import require

LOCK_PATH = "docker/managed/packages/sources.lock.json"
PACKAGE_OWNERS = {"krb5-libs": "krb5", "libcurl-openssl4": "curl", "curl": "curl",
                  "cyrus-sasl-heimdal-libs": "sasl", "libstdc++-dev": "gcc_headers"}

# Runs inside the already selected, read-only, network-disabled image. It only
# reads package records, archives and their installed /usr payloads. It does not
# invoke a library, reproduce a vulnerability, or alter the scanner inventory.
PACKAGE_PROBE = r'''
if Path("/usr/lib/apk/db/installed").is_file():
    import hashlib, os, stat
    build = Path("/usr/share/nac/runtime-package-build")
    records = {}
    actual = {}
    for path in sorted(Path("/usr/share/nac/package-provenance").glob("*.json")):
        record = json.loads(path.read_text())
        records[path.stem] = record
        payload = record["installed_payload"]
        if not isinstance(payload, dict) or not 0 < len(payload) <= 20000:
            raise ValueError("invalid installed package payload")
        actual[path.stem] = {}
        for name in payload:
            p = Path(name)
            if (not isinstance(name, str) or not name.startswith("/usr/") or
                    str(p) != name or ".." in p.parts or p.parent.resolve() != p.parent):
                raise ValueError("noncanonical installed package payload path")
            if p.is_symlink():
                if not p.resolve().is_relative_to("/usr"):
                    raise ValueError("installed package symlink escapes /usr")
                value = {"symlink": os.readlink(p)}
            else:
                with os.fdopen(os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
                    if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                        raise ValueError("installed package payload is not a regular file")
                    value = {"sha256": hashlib.file_digest(source, "sha256").hexdigest()}
            actual[path.stem][name] = value
    evidence["owned_packages"] = {
        "lock": json.loads((build / "sources.lock.json").read_text()) if build.is_dir() else None,
        "records": records, "actual_payloads": actual,
        "archive_hashes": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in sorted(build.glob("*.apk"))},
        "archive_manifest": (build / "packages.sha256").read_text() if build.is_dir() else None}
'''


def source_package_pins(dockerfile, read_source):
    """Capture pins from the immutable image source, not today's checkout."""
    if "cgr.dev/chainguard/wolfi-base@sha256:" not in dockerfile:
        return None
    pins = json.loads(read_source(LOCK_PATH))
    require(isinstance(pins, dict) and pins.get("schema_version") == 1,
            "missing/unsupported runtime package source lock")
    require(set(pins) == {"schema_version", "downloads", *PACKAGE_OWNERS.values()},
            "incomplete/unknown runtime package source owners")
    require(isinstance(pins["downloads"], dict) and pins["downloads"], "missing package source downloads")
    for name, entry in pins["downloads"].items():
        require(isinstance(name, str) and "/" not in name and name not in {"", ".", ".."} and
                isinstance(entry, dict) and set(entry) == {"url", "sha256"} and
                isinstance(entry["url"], str) and entry["url"].startswith("https://") and
                isinstance(entry["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]),
                "malformed pinned package source download")
    for owner in set(PACKAGE_OWNERS.values()):
        spec = pins[owner]
        require(isinstance(spec, dict) and all(k in spec for k in (
            "version", "package_version", "source_commit", "license", "archive", "patches", "upstream_name")),
            f"incomplete runtime package source: {owner}")
        require(isinstance(spec["source_commit"], str) and re.fullmatch(r"[0-9a-f]{40}", spec["source_commit"]),
                f"malformed runtime package source revision: {owner}")
        require(isinstance(spec["patches"], list) and
                all(isinstance(p, str) and p in pins["downloads"] for p in [spec["archive"], *spec["patches"]]),
                f"unpinned runtime package source or patch: {owner}")
    return pins


def package_integrity(evidence, pins, artifacts):
    """Bind installed bytes to reviewed recipes, without an applicability verdict."""
    require(isinstance(pins, dict), "Wolfi bundle lacks retained runtime package source pins")
    require(isinstance(evidence, dict) and set(evidence) == {
        "lock", "records", "actual_payloads", "archive_hashes", "archive_manifest"},
        "missing/incomplete installed runtime package evidence")
    require(evidence["lock"] == pins, "installed package source lock differs from image source")
    records, payloads = evidence["records"], evidence["actual_payloads"]
    require(isinstance(records, dict) and isinstance(payloads, dict) and
            set(records) == set(payloads) == set(PACKAGE_OWNERS),
            "missing/unknown owned runtime package")
    archives = {}
    for name, owner in PACKAGE_OWNERS.items():
        spec, record = pins[owner], records[name]
        expected = {"schema_version": 1, "supplier": "NAC", "package": name,
                    **spec, "downloads": pins["downloads"]}
        require(isinstance(record, dict) and set(record) == {*expected, "installed_payload"} and
                all(record[k] == v for k, v in expected.items()),
                f"runtime package source/provenance differs: {name}")
        payload = record["installed_payload"]
        require(isinstance(payload, dict) and payload and payload == payloads[name],
                f"installed runtime package bytes differ: {name}")
        for path, signature in payload.items():
            require(isinstance(path, str) and path.startswith("/usr/") and
                    str(PurePosixPath(path)) == path and ".." not in PurePosixPath(path).parts,
                    f"noncanonical runtime package payload: {name}")
            require(isinstance(signature, dict) and (
                set(signature) == {"sha256"} and isinstance(signature["sha256"], str) and
                re.fullmatch(r"[0-9a-f]{64}", signature["sha256"]) or
                set(signature) == {"symlink"} and isinstance(signature["symlink"], str) and signature["symlink"]),
                f"malformed runtime package payload signature: {name}")
        matches = [p for p in artifacts if p.get("type") == "apk" and p.get("name") == name]
        require(len(matches) == 1 and matches[0].get("version") == spec["package_version"] and
                matches[0].get("metadata", {}).get("originPackage") == spec["upstream_name"],
                f"owned runtime package missing/mismatched in actual SBOM: {name}")
        archives[f"{name}-{spec['package_version']}.apk"] = None
    hashes = evidence["archive_hashes"]
    require(isinstance(hashes, dict) and set(hashes) == set(archives) and all(
        isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in hashes.values()),
        "missing/malformed owned package archives")
    require(isinstance(evidence["archive_manifest"], str), "missing owned package archive manifest")
    declared = {}
    for line in evidence["archive_manifest"].splitlines():
        fields = line.split()
        require(len(fields) == 2 and fields[1].startswith("./") and fields[1][2:] in hashes and
                fields[1][2:] not in declared, "malformed/duplicate owned package archive manifest")
        declared[fields[1][2:]] = fields[0]
    require(declared == hashes, "owned package archive hash mismatch")
    return {"packages": {name: {"version": records[name]["version"],
                               "package_version": records[name]["package_version"],
                               "source_commit": records[name]["source_commit"],
                               "payload_files": len(records[name]["installed_payload"])} for name in records},
            "scope": "passive source/package/file integrity only; no advisory suppression or clearance"}
