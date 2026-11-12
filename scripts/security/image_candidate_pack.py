"""Stage only the hashed V4 inventory members for a frozen image artifact.

Inventory diagnostics stay in ordinary scan evidence. They are not inputs to
the independently reviewed artifact and must not expand its ZIP member set.
"""

import argparse
import hashlib
import os
from pathlib import Path
import re
import stat
import sys

from image_approval_intake import parse_json, require
from image_candidate_archive import MAX_INVENTORY_BYTES, MAX_MEMBERS, MAX_METADATA_BYTES


NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,240}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")


def _read_regular(directory_fd, name, maximum):
    with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                          dir_fd=directory_fd), "rb") as source:
        metadata = os.fstat(source.fileno())
        require(stat.S_ISREG(metadata.st_mode) and 0 < metadata.st_size <= maximum,
                f"missing or oversized candidate input: {name}")
        raw = source.read(metadata.st_size + 1)
        require(len(raw) == metadata.st_size,
                f"candidate input changed size while reading: {name}")
        return raw


def stage_inventory(bundle, destination, *, image, source_revision):
    """Copy and hash only manifest-listed files into a new, isolated directory."""
    bundle, destination = Path(bundle), Path(destination)
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", image) and
            re.fullmatch(r"[a-f0-9]{40}", source_revision),
            "candidate image/source identity is invalid")
    require(not destination.exists() and not destination.is_symlink(),
            "candidate staging destination already exists")
    source_fd = os.open(bundle, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        raw_manifest = _read_regular(source_fd, "bundle.json", MAX_METADATA_BYTES)
        manifest = parse_json(raw_manifest)
        files = manifest.get("files") if type(manifest) is dict else None
        require(type(manifest) is dict and manifest.get("schema_version") == 4 and
                manifest.get("image") == image and type(files) is dict and
                1 <= len(files) <= MAX_MEMBERS - 2 and
                "identity.json" in files and "bundle.json" not in files and
                all(type(name) is str and NAME.fullmatch(name) and
                    type(digest) is str and SHA256.fullmatch(digest)
                    for name, digest in files.items()),
                "candidate V4 inventory manifest is invalid")
        identity = parse_json(_read_regular(source_fd, "identity.json", MAX_METADATA_BYTES))
        require(type(identity) is dict and identity.get("image") == image and
                identity.get("source_revision") == source_revision,
                "candidate inventory differs from exact image/source")
        destination.mkdir(mode=0o700)
        inventory = destination / "inventory"
        inventory.mkdir(mode=0o700)
        (inventory / "bundle.json").write_bytes(raw_manifest)
        total = len(raw_manifest)
        for name, expected in sorted(files.items()):
            with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                  dir_fd=source_fd), "rb") as source:
                metadata = os.fstat(source.fileno())
                require(stat.S_ISREG(metadata.st_mode) and 0 < metadata.st_size <= MAX_INVENTORY_BYTES and
                        total + metadata.st_size <= MAX_INVENTORY_BYTES,
                        f"missing or oversized candidate input: {name}")
                checksum, copied = hashlib.sha256(), 0
                with (inventory / name).open("xb") as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        copied += len(chunk)
                        require(copied <= metadata.st_size, f"candidate input grew: {name}")
                        checksum.update(chunk)
                        target.write(chunk)
                require(copied == metadata.st_size and checksum.hexdigest() == expected,
                        f"candidate inventory hash mismatch: {name}")
                total += copied
        require({path.name for path in inventory.iterdir()} ==
                {"bundle.json", *files}, "candidate staging member set changed")
    finally:
        os.close(source_fd)
    return inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--image", required=True)
    parser.add_argument("--source-revision", required=True)
    args = parser.parse_args()
    try:
        stage_inventory(args.bundle, args.destination, image=args.image,
                        source_revision=args.source_revision)
    except Exception as error:
        print(f"candidate inventory staging failed closed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
