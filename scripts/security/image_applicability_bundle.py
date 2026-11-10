"""Retained passive applicability inputs; no rule admission or finding changes.

Export only a fresh never-started container of the scanned immutable image.
Rescans recollect the complete retained tar and preserve its original clock;
they never turn candidate JSON assertions into current observations.
"""
import datetime as dt
import hashlib
from pathlib import Path
import re
from urllib.parse import urlsplit

import image_applicability_evidence as collector
from image_applicability import binding, document, timestamp
from image_inventory import require, sha256

ARCHIVE = "applicability-filesystem.tar"
CONTEXT = "applicability-context.json"
IMAGE_INSPECT = "applicability-image-inspect.json"
CONTAINER_INSPECT = "applicability-container-inspect.json"
PROFILES = {name: "applicability-" + name + ".json"
            for name in ("provenance", "filesystem", "consumers")}
MAX_ARCHIVE_BYTES = 32 * 1024 ** 3
MAX_SOURCE_BYTES = 150 * 1024 ** 2
MAX_JSON_BYTES = 512 * 1024 ** 2
COORDINATES = {
    "krb5-libs": ("apk:krb5-libs", "upstream:mit/kerberos_5", "upstream-wolfi:krb5"),
    "curl": ("apk:curl", "upstream:haxx/curl", "upstream-wolfi:curl"),
    "libcurl-openssl4": ("apk:libcurl-openssl4", "upstream:haxx/curl", "upstream-wolfi:curl"),
}


def source_files(identity):
    """Validate pins before deriving any filesystem paths or download requests."""
    require(isinstance(identity, dict), "missing applicability image identity")
    require(isinstance(identity.get("inspected"), dict), "missing scanned image inspection")
    collector.subject_identity(identity.get("image"), identity.get("source_revision"), [identity["inspected"]])
    pins = identity.get("runtime_package_pins")
    require(isinstance(pins, dict) and type(pins.get("schema_version")) is int and
            pins["schema_version"] == 1, "missing applicability source pins")
    downloads = pins.get("downloads")
    require(isinstance(downloads, dict) and 0 < len(downloads) <= 256, "invalid applicability downloads")
    for name, spec in downloads.items():
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,160}", name),
                "unsafe applicability source basename")
        require(isinstance(spec, dict) and set(spec) == {"url", "sha256"} and
                isinstance(spec["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", spec["sha256"]),
                "invalid applicability source digest")
        require(isinstance(spec["url"], str) and not re.search(r"[\x00-\x20\x7f]", spec["url"]),
                "invalid applicability source URL")
        url = urlsplit(spec["url"])
        require(url.scheme == "https" and url.hostname and not url.username and not url.password and
                not url.fragment, "noncanonical applicability source URL")
    selected = set()
    for owner in ("curl", "krb5"):
        spec = pins.get(owner)
        require(isinstance(spec, dict) and all(isinstance(spec.get(field), str) and spec[field] and
                not re.search(r"[\x00-\x20\x7f]", spec[field]) for field in
                ("version", "package_version", "source_commit", "license", "upstream_name")) and
                re.fullmatch(r"[a-f0-9]{40}", spec["source_commit"]), "incomplete applicability package pins")
        patches, archive = spec.get("patches"), spec.get("archive")
        require(isinstance(patches, list) and len(patches) <= 128 and
                all(isinstance(name, str) for name in [archive, *patches]), "invalid applicability source list")
        names = [archive, *patches]
        require(len(set(names)) == len(names) and all(name in downloads for name in names),
                "missing/duplicate applicability source pins")
        selected.update(names)
    return {name: "applicability-source-" + name for name in sorted(selected)}


def files(identity):
    """Deterministic flat extension set; the caller owns the base bundle files."""
    return {ARCHIVE, CONTEXT, IMAGE_INSPECT, CONTAINER_INSPECT, *PROFILES.values(),
            *source_files(identity).values()}


def regular(path, maximum):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= maximum,
            f"missing/nonregular/oversized applicability input: {path.name}")
    return path


def read_json(output, name):
    return document(regular(output / name, MAX_JSON_BYTES).read_bytes(), name)


def write_json(output, name, value):
    with (output / name).open("xb") as target:
        target.write(collector.canonical_json(value))


def inspections(identity, inspected, container_inspected, container_id):
    require(inspected == [identity["inspected"]], "applicability image inspection changed")
    collector.subject_identity(identity["image"], identity["source_revision"], inspected)
    collector.export_container(identity["image"], inspected, container_inspected)
    container = container_inspected[0]
    require(isinstance(container_id, str) and re.fullmatch(r"[a-f0-9]{64}", container_id) and
            container.get("Id") == container_id and
            container.get("HostConfig", {}).get("NetworkMode") == "none" and
            container.get("HostConfig", {}).get("ReadonlyRootfs") is True,
            "applicability container identity/network/read-only configuration differs")


def capture(identity, output, command, download):
    """Retain binary export by filename, pinned source bytes and passive profiles.

    `command` has the image scanner's text-only command interface. Docker writes
    the potentially large tar directly; binary bytes never enter stdout. Export
    timeout and the explicit post-export 32 GiB bound fail the operation closed.
    """
    output = Path(output)
    retained, sources = files(identity), source_files(identity)
    require(output.is_dir() and not output.is_symlink() and
            all(not (output / name).exists() and not (output / name).is_symlink() for name in retained),
            "applicability output already exists or is not a directory")
    collected_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    container_id = command(["docker", "create", "--platform", "linux/amd64", "--network", "none",
                            "--read-only", identity["image"]]).strip()
    require(re.fullmatch(r"[a-f0-9]{64}", container_id), "Docker did not return an exact owned container ID")
    try:
        inspected = document(command(["docker", "image", "inspect", identity["image"]]).encode(), IMAGE_INSPECT)
        container_inspected = document(command(["docker", "container", "inspect", container_id]).encode(), CONTAINER_INSPECT)
        inspections(identity, inspected, container_inspected, container_id)
        command(["docker", "export", "--output", str(output / ARCHIVE), container_id], timeout=1800)
        regular(output / ARCHIVE, MAX_ARCHIVE_BYTES)
    finally:
        # Never remove a tag, broad selection, preexisting container or runtime.
        command(["docker", "rm", "-v", container_id])
    write_json(output, IMAGE_INSPECT, inspected)
    write_json(output, CONTAINER_INSPECT, container_inspected)
    pins = identity["runtime_package_pins"]
    downloads = {}
    for name, filename in sources.items():
        spec = pins["downloads"][name]
        data = download(spec["url"], limit=MAX_SOURCE_BYTES)
        require(isinstance(data, bytes) and len(data) <= MAX_SOURCE_BYTES and
                hashlib.sha256(data).hexdigest() == spec["sha256"], "applicability source download mismatch")
        path = output / filename
        with path.open("xb") as target:
            target.write(data)
        downloads[name] = path
    evidence = collector.collect_evidence(output / ARCHIVE, image=identity["image"],
        source_revision=identity["source_revision"], inspected=inspected,
        container_inspected=container_inspected, pins=pins, downloads=downloads)
    for name, filename in PROFILES.items():
        write_json(output, filename, evidence[name])
    write_json(output, CONTEXT, {"schema_version": 1, "subject": evidence["provenance"]["subject"],
        "collected_at": collected_at, "container_id": container_id,
        "archive_sha256": sha256(output / ARCHIVE),
        "image_inspect_sha256": sha256(output / IMAGE_INSPECT),
        "container_inspect_sha256": sha256(output / CONTAINER_INSPECT),
        "source_sha256": {name: sha256(path) for name, path in downloads.items()}})
    return retained


def validate(output, identity):
    """Recollect complete retained inputs; return observations at their old clock."""
    output = Path(output)
    sources = source_files(identity)
    require(output.is_dir() and not output.is_symlink(), "invalid applicability retained directory")
    for name in files(identity):
        maximum = MAX_ARCHIVE_BYTES if name == ARCHIVE else MAX_SOURCE_BYTES if name in sources.values() else MAX_JSON_BYTES
        regular(output / name, maximum)
    context = read_json(output, CONTEXT)
    require(isinstance(context, dict) and set(context) == {"schema_version", "subject", "collected_at",
            "container_id", "archive_sha256", "image_inspect_sha256", "container_inspect_sha256", "source_sha256"} and
            type(context["schema_version"]) is int and context["schema_version"] == 1,
            "invalid applicability collection context")
    timestamp(context["collected_at"])
    subject = {"image": identity["image"], "source_revision": identity["source_revision"], "platform": "linux/amd64"}
    require(context["subject"] == subject and context["archive_sha256"] == sha256(output / ARCHIVE) and
            context["image_inspect_sha256"] == sha256(output / IMAGE_INSPECT) and
            context["container_inspect_sha256"] == sha256(output / CONTAINER_INSPECT),
            "applicability retained context/image hashes differ")
    pins = identity["runtime_package_pins"]
    downloads = {name: output / filename for name, filename in sources.items()}
    require(context["source_sha256"] == {name: pins["downloads"][name]["sha256"] for name in sources} and
            all(sha256(path) == context["source_sha256"][name] for name, path in downloads.items()),
            "applicability retained source hashes differ")
    inspected, container_inspected = read_json(output, IMAGE_INSPECT), read_json(output, CONTAINER_INSPECT)
    inspections(identity, inspected, container_inspected, context["container_id"])
    provenance = collector.validate_evidence({name: read_json(output, filename) for name, filename in PROFILES.items()},
        output / ARCHIVE, image=identity["image"], source_revision=identity["source_revision"],
        inspected=inspected, container_inspected=container_inspected, pins=pins, downloads=downloads)
    observations = []
    for installed, coordinates in COORDINATES.items():
        package = provenance["packages"][installed]
        for coordinate in coordinates:
            observed = {**subject, "package": coordinate, "installed_package": "apk:" + installed,
                **{key: package[key] for key in ("package_version", "upstream_version", "source_sha256",
                                                "patches_sha256", "payload_sha256")},
                "application_profile_sha256": provenance["application_profile_sha256"]}
            binding(observed)
            observations.append({"binding": observed, "observed_at": context["collected_at"]})
    return observations
