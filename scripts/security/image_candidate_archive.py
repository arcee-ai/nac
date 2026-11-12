"""Bounded intake of a frozen, independently authenticated image artifact.

The caller must first authenticate the Actions artifact and protected approval
record with image_approval_intake. This module only handles untrusted ZIP bytes;
it does not confer approval or receive a status-publishing credential.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import zipfile

from image_approval_intake import ApprovalError, digest, hex_sha, parse_json, require


MAX_ZIP_BYTES = 16 * 1024 ** 3
MAX_IMAGE_BYTES = 16 * 1024 ** 3
MAX_INVENTORY_BYTES = 40 * 1024 ** 3
MAX_MEMBERS = 512
MAX_METADATA_BYTES = 4 * 1024 ** 2
IMAGE_NAME = "image.tar"
INVENTORY = "inventory"


def _sha256_file(path, maximum):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= maximum,
            "missing, linked or oversized artifact archive")
    hashed = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hashed.update(chunk)
    return "sha256:" + hashed.hexdigest()


def _member_name(info):
    name = info.filename
    require(isinstance(name, str) and "\\" not in name and "\x00" not in name and
            not name.startswith("/") and not name.endswith("/") and
            name not in {".", ".."}, "unsafe artifact member name")
    parts = name.split("/")
    require(all(part not in {"", ".", ".."} for part in parts) and
            (name == IMAGE_NAME or len(parts) == 2 and parts[0] == INVENTORY and
             re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,240}", parts[1])),
            "unexpected artifact member")
    mode = (info.external_attr >> 16) & 0xFFFF
    kind = stat.S_IFMT(mode)
    require(not info.is_dir() and kind in {0, stat.S_IFREG} and not info.flag_bits & 1,
            "linked, directory or encrypted artifact member")
    return name


def _metadata(path, maximum=MAX_METADATA_BYTES):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= maximum,
            "missing or oversized artifact metadata")
    try:
        return json.loads(path.read_bytes())
    except (ValueError, UnicodeError) as error:
        raise ApprovalError("invalid artifact metadata") from error


def extract_candidate(archive, destination, *, artifact_digest, image, source_revision):
    """Verify ZIP bytes and extract only one image plus a flat V4 inventory.

    Destination must not exist. A failed extraction remains unusable and should
    be removed by the isolated caller's temporary-directory cleanup.
    """
    archive, destination = Path(archive), Path(destination)
    digest(artifact_digest, "artifact digest")
    digest(image, "image ID")
    hex_sha(source_revision, "source revision")
    require(_sha256_file(archive, MAX_ZIP_BYTES) == artifact_digest,
            "downloaded artifact archive digest changed")
    require(not destination.exists() and not destination.is_symlink(),
            "artifact destination already exists")
    try:
        with zipfile.ZipFile(archive) as zipped:
            members = zipped.infolist()
            require(2 <= len(members) <= MAX_MEMBERS, "invalid artifact member count")
            names = [_member_name(info) for info in members]
            require(len(set(names)) == len(names) and IMAGE_NAME in names and
                    f"{INVENTORY}/bundle.json" in names and
                    f"{INVENTORY}/identity.json" in names,
                    "missing or duplicate frozen candidate inputs")
            require(next(info.file_size for info in members if info.filename == IMAGE_NAME) <= MAX_IMAGE_BYTES and
                    sum(info.file_size for info in members if info.filename != IMAGE_NAME) <= MAX_INVENTORY_BYTES,
                    "oversized frozen candidate inputs")
            destination.mkdir(mode=0o700)
            (destination / INVENTORY).mkdir(mode=0o700)
            for info in members:
                target = destination / info.filename
                with zipped.open(info) as source, os.fdopen(os.open(
                        target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb") as output:
                    copied = 0
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        copied += len(chunk)
                        require(copied <= info.file_size, "artifact member grew while extracting")
                        output.write(chunk)
                    require(copied == info.file_size, "artifact member changed size")
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise ApprovalError("artifact extraction failed") from error
    manifest = _metadata(destination / INVENTORY / "bundle.json")
    identity = _metadata(destination / INVENTORY / "identity.json")
    require(type(manifest) is dict and manifest.get("schema_version") == 4 and
            manifest.get("image") == image and type(manifest.get("files")) is dict and
            type(identity) is dict and identity.get("image") == image and
            identity.get("source_revision") == source_revision,
            "frozen V4 bundle differs from reviewed image/source")
    require({f"{INVENTORY}/{name}" for name in manifest["files"]} ==
            set(names) - {IMAGE_NAME, f"{INVENTORY}/bundle.json"},
            "frozen inventory member set differs from bundle")
    return destination / IMAGE_NAME, destination / INVENTORY


def load_exact_image(image_tar, image, *, run=subprocess.run):
    """Load in a credential-free isolated job and recheck Docker's image ID."""
    digest(image, "image ID")
    require(Path(image_tar).is_file() and not Path(image_tar).is_symlink(),
            "frozen image archive missing")
    _check_image_config(image_tar, image)
    try:
        prior = run(["docker", "image", "inspect", image], check=False,
                    capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ApprovalError("cannot establish clean image load") from error
    require(prior.returncode != 0, "approved image was already present before load")
    try:
        run(["docker", "image", "load", "--input", str(image_tar)], check=True,
            capture_output=True, text=True, timeout=1800)
        inspected = run(["docker", "image", "inspect", image], check=True,
                        capture_output=True, text=True, timeout=60)
        details = json.loads(inspected.stdout)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired,
            ValueError) as error:
        raise ApprovalError("frozen image load or inspection failed") from error
    require(type(details) is list and len(details) == 1 and
            details[0].get("Id") == image and details[0].get("Os") == "linux" and
            details[0].get("Architecture") == "amd64",
            "loaded image ID or platform differs from approval")
    return image


def _descriptor(archive, sha, *, expected_size=None):
    digest(sha, "OCI descriptor")
    member = archive.getmember(f"blobs/sha256/{sha[7:]}")
    require(member.isfile() and member.size <= MAX_METADATA_BYTES and
            (expected_size is None or member.size == expected_size),
            "missing or oversized selected OCI descriptor")
    raw = archive.extractfile(member).read(MAX_METADATA_BYTES + 1)
    require(len(raw) == member.size and hashlib.sha256(raw).hexdigest() == sha[7:],
            "selected OCI descriptor bytes differ from digest")
    return parse_json(raw)


def _selected_manifest(archive, approved, *, architecture):
    """Follow only the approved index/manifest chain to one exact platform."""
    current = _descriptor(archive, approved)
    for _ in range(2):
        require(type(current) is dict, "selected OCI descriptor is not an object")
        media = current.get("mediaType")
        if media in {"application/vnd.oci.image.manifest.v1+json",
                     "application/vnd.docker.distribution.manifest.v2+json"}:
            return current
        require(media == "application/vnd.oci.image.index.v1+json" and
                type(current.get("manifests")) is list and current["manifests"],
                "unsupported selected OCI descriptor")
        selected = []
        for entry in current["manifests"]:
            require(type(entry) is dict and type(entry.get("size")) is int and
                    entry["size"] > 0 and type(entry.get("digest")) is str,
                    "malformed OCI child descriptor")
            platform = entry.get("platform")
            if platform is None and entry.get("mediaType") == "application/vnd.oci.image.index.v1+json":
                selected.append(entry)
            elif platform == {"os": "linux", "architecture": architecture} and entry.get("mediaType") in {
                    "application/vnd.oci.image.manifest.v1+json",
                    "application/vnd.docker.distribution.manifest.v2+json"}:
                selected.append(entry)
            else:
                annotations = entry.get("annotations", {})
                require(platform == {"os": "unknown", "architecture": "unknown"} and
                        type(annotations) is dict and
                        annotations.get("vnd.docker.reference.type") == "attestation-manifest",
                        "unverifiable extra platform in approved OCI index")
        require(len(selected) == 1, "approved OCI index lacks one selected platform")
        choice = selected[0]
        current = _descriptor(archive, choice["digest"], expected_size=choice["size"])
    require(False, "approved OCI index nesting exceeds supported depth")


def _check_image_config(image_tar, image, *, architecture="amd64"):
    """Bind approved ID to one selected manifest, config and platform before load.

    Docker may report either a config digest or an OCI index/manifest digest as
    its image ID. No image layer is extracted by this parser.
    """
    try:
        with tarfile.open(image_tar, mode="r:") as archive:
            members = archive.getmembers()
            require(2 <= len(members) <= 1024, "invalid saved image member count")
            names = [member.name for member in members]
            require(len(set(names)) == len(names) and "manifest.json" in names,
                    "missing or duplicate saved image manifest")
            for member in members:
                require(not member.name.startswith("/") and "\\" not in member.name and
                        all(part not in {"", ".", ".."} for part in member.name.rstrip("/").split("/")) and
                        (member.isfile() or member.isdir()),
                        "unsafe saved image member")
            manifest_member = archive.getmember("manifest.json")
            require(manifest_member.isfile() and manifest_member.size <= MAX_METADATA_BYTES,
                    "oversized saved image manifest")
            manifest = parse_json(archive.extractfile(manifest_member).read(MAX_METADATA_BYTES + 1))
            require(type(manifest) is list and len(manifest) == 1 and
                    type(manifest[0]) is dict, "saved archive contains multiple images")
            config_name = manifest[0].get("Config")
            require(type(config_name) is str and
                    re.fullmatch(r"blobs/sha256/[a-f0-9]{64}|[a-f0-9]{64}\.json", config_name),
                    "saved image config path is invalid")
            config_member = archive.getmember(config_name)
            require(config_member.isfile() and config_member.size <= MAX_METADATA_BYTES,
                    "missing or oversized saved image config")
            config = archive.extractfile(config_member).read(MAX_METADATA_BYTES + 1)
            require(len(config) == config_member.size and
                    hashlib.sha256(config).hexdigest() ==
                    (config_name.split("/")[-1].removesuffix(".json")),
                    "saved image config bytes differ from its digest")
            config_info = parse_json(config)
            require(type(config_info) is dict and config_info.get("os") == "linux" and
                    config_info.get("architecture") == architecture,
                    "saved image config platform differs from approval")
            if hashlib.sha256(config).hexdigest() != image[7:]:
                # Containerd-backed Docker reports an OCI index or manifest
                # digest as Id instead of the selected config digest.
                index_member = archive.getmember("index.json")
                require(index_member.isfile() and index_member.size <= MAX_METADATA_BYTES,
                        "missing or oversized OCI index")
                index = parse_json(archive.extractfile(index_member).read(MAX_METADATA_BYTES + 1))
                require(type(index) is dict and type(index.get("manifests")) is list and
                        len(index["manifests"]) == 1 and
                        type(index["manifests"][0]) is dict and
                        index["manifests"][0].get("digest") == image and
                        type(index["manifests"][0].get("size")) is int,
                        "saved OCI index does not reference approved ID")
                root_entry = index["manifests"][0]
                approved_descriptor = _descriptor(archive, image,
                                                  expected_size=root_entry["size"])
                require(type(approved_descriptor) is dict and
                        root_entry.get("mediaType") == approved_descriptor.get("mediaType") and
                        root_entry.get("platform") in (None, {"os": "linux", "architecture": architecture}),
                        "approved OCI root descriptor type/platform differs")
                selected = _selected_manifest(archive, image, architecture=architecture)
                selected_config = selected.get("config")
                require(type(selected_config) is dict and
                        selected_config.get("digest") ==
                        f"sha256:{hashlib.sha256(config).hexdigest()}" and
                        selected_config.get("size") == len(config),
                        "selected OCI manifest config differs from saved image")
    except ApprovalError:
        raise
    except (OSError, tarfile.TarError, KeyError, ValueError) as error:
        raise ApprovalError("saved image archive validation failed") from error
