"""Recollect stale V4 inputs from an unchanged, already loaded exact image.

Keep the authenticated frozen ZIP and extracted bundle untouched. This source-
only helper derives a separately hashed bundle; it grants no approval and does
not publish a status. The reviewed policy must still validate new observations.
"""

import copy
from pathlib import Path
import re
import shutil

import image_applicability_bundle as bundle
import image_applicability_evidence as collector
import image_approval_intake as intake
import image_scan
from image_inventory import sha256, write_json


BASE_FILES = frozenset({"sbom.syft.json", "runtime.json", "coverage.json",
                        *image_scan.RUST_FILES})
MUTABLE_INSPECT_FIELDS = frozenset({"RepoTags", "RepoDigests"})
MUTABLE_METADATA_FIELDS = frozenset({"LastTagTime"})
BUILD_REF = re.compile(r"[a-z0-9]{12,128}\Z")
BUILD_TIME = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z\Z")


def verify_frozen(inventory, destination, *, image, source_revision):
    """Hash and fully validate the original V4 before using a derivative."""
    inventory, destination = Path(inventory), Path(destination)
    intake.require(not destination.exists() and not destination.is_symlink(),
                   "verified frozen directory already exists")
    destination.mkdir(mode=0o700)
    manifest = bundle.read_json(inventory, "bundle.json", maximum=4 * 1024 ** 2)
    intake.require(type(manifest) is dict and manifest.get("schema_version") == 4,
                   "frozen candidate must include complete V4 inputs")
    identity = image_scan.load_bundle(inventory, destination)
    intake.require(identity.get("image") == image and
                   identity.get("source_revision") == source_revision,
                   "frozen V4 differs from selected image/source")
    bundle.validate(destination, identity)
    return identity


def bind_loaded_inspect(frozen, actual, *, image, source_revision):
    """Allow only Docker tag/location metadata to change on clean load."""
    intake.require(type(frozen) is dict and type(actual) is dict,
                   "image inspection must be an object")
    collector.subject_identity(image, source_revision, [frozen])
    collector.subject_identity(image, source_revision, [actual])
    rootfs = frozen.get("RootFS")
    intake.require(type(rootfs) is dict and rootfs.get("Type") == "layers" and
                   type(rootfs.get("Layers")) is list and bool(rootfs["Layers"]) and
                   all(type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value)
                       for value in rootfs["Layers"]),
                   "frozen image rootfs is missing or malformed")
    build = frozen.get("Identity")
    intake.require(type(build) is dict and set(build) == {"Build"} and
                   type(build["Build"]) is list and len(build["Build"]) == 1 and
                   type(build["Build"][0]) is dict and
                   set(build["Build"][0]) == {"CreatedAt", "Ref"} and
                   type(build["Build"][0]["CreatedAt"]) is str and
                   BUILD_TIME.fullmatch(build["Build"][0]["CreatedAt"]) and
                   type(build["Build"][0]["Ref"]) is str and
                   BUILD_REF.fullmatch(build["Build"][0]["Ref"]),
                   "frozen Docker build identity is missing or malformed")
    # Moby serializes a lost local Build identity with `omitempty` after load.
    # The original verified object remains in the frozen bundle/receipt; this
    # permitted serialization loss is not proof of signed origin equivalence.
    intake.require(actual.get("Identity") is None or actual["Identity"] == build,
                   "loaded Docker build identity changed unexpectedly")
    stable = (set(frozen) | set(actual)) - MUTABLE_INSPECT_FIELDS - {"Metadata", "Identity"}
    intake.require(all(key in frozen and key in actual and frozen[key] == actual[key]
                       for key in stable),
                   "loaded image immutable inspection differs from frozen image")
    for key in MUTABLE_INSPECT_FIELDS:
        intake.require(key in frozen and key in actual and
                       all(type(value) is list and
                           all(type(item) is str for item in value)
                           for value in (frozen[key], actual[key])),
                       "loaded image tag/location metadata is malformed")
    old_meta, new_meta = frozen.get("Metadata"), actual.get("Metadata")
    intake.require(type(old_meta) is dict and type(new_meta) is dict and
                   all(old_meta.get(key) == new_meta.get(key) and
                       key in old_meta and key in new_meta
                       for key in (set(old_meta) | set(new_meta)) - MUTABLE_METADATA_FIELDS),
                   "loaded image immutable metadata differs from frozen image")
    return actual


def recollect(inventory, verified, destination, identity, *, image,
              source_revision, command=image_scan.command,
              download=image_scan.download):
    """Create a derivative with same base bytes and fresh actual observations."""
    inventory, verified, destination = map(Path, (inventory, verified, destination))
    intake.require(not destination.exists() and not destination.is_symlink(),
                   "derivative bundle already exists")
    intake.require(identity.get("image") == image and
                   identity.get("source_revision") == source_revision,
                   "frozen identity differs from selected image/source")
    old_manifest_hash = sha256(inventory / "bundle.json")
    old_identity_hash = sha256(inventory / "identity.json")
    actual = intake.parse_json(command(["docker", "image", "inspect", image]).encode())
    intake.require(type(actual) is list and len(actual) == 1,
                   "loaded image inspection is ambiguous")
    inspected = bind_loaded_inspect(identity["inspected"], actual[0],
                                    image=image, source_revision=source_revision)
    derivative_identity = copy.deepcopy(identity)
    derivative_identity["inspected"] = inspected
    destination.mkdir(mode=0o700)
    for name in BASE_FILES:
        shutil.copyfile(verified / name, destination / name)
        intake.require(sha256(destination / name) == sha256(verified / name),
                       "derivative base input bytes changed")
    write_json(destination / "identity.json", derivative_identity)
    bundle.capture(derivative_identity, destination, command, download,
                   schema_version=4)
    bundle.validate(destination, derivative_identity)
    image_scan.bundle_manifest(destination, image)
    intake.require(sha256(inventory / "bundle.json") == old_manifest_hash and
                   sha256(inventory / "identity.json") == old_identity_hash,
                   "frozen bundle or identity changed during recollection")
    receipt = {"schema_version": 1, "image": image,
               "source_revision": source_revision,
               "frozen_bundle_sha256": old_manifest_hash,
               "frozen_identity_sha256": old_identity_hash,
               "derivative_bundle_sha256": sha256(destination / "bundle.json"),
               "derivative_identity_sha256": sha256(destination / "identity.json")}
    write_json(destination.parent / "refresh-receipt.json", receipt)
    return destination
