#!/usr/bin/env python3
"""Install one checksum-pinned official Linux nextest into a new owned leaf."""

import argparse
import hashlib
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import urllib.request

VERSION = "0.9.151"
COMMIT = "6b3f994577a98874a2e0ea5bef77fbbab3434044"
# Public release-asset API avoids the failing browser download route. Keep the
# asset ID version-bound; a new version needs an explicitly qualified mapping.
ASSET_IDS = {"0.9.151": 703600788}
URL = f"https://api.github.com/repos/nextest-rs/nextest/releases/assets/{ASSET_IDS[VERSION]}"
SHA256 = "1d4ce302b820c41f4b89c5fb9bce45f0f0c94882c1cf08fc360caf08be6e7df4"
ARCHIVE_BYTES = 12161169
MAX_BINARY_BYTES = 128 * 1024 * 1024


def copy_bounded(source, destination, limit):
    total = 0
    while chunk := source.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise ValueError("nextest download exceeds bound")
        destination.write(chunk)
    return total


def verify_archive(archive):
    if not stat.S_ISREG(archive.lstat().st_mode):
        raise ValueError("nextest archive must be a regular file, not a symlink")
    if archive.stat().st_size != ARCHIVE_BYTES:
        raise ValueError("wrong nextest archive size")
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != SHA256:
        raise ValueError("wrong nextest archive SHA256")


def extract_binary(archive, output):
    # Called only after verifying the immutable archive pin. Never extract paths.
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if (len(members) != 1 or members[0].name != "cargo-nextest"
                or not members[0].isfile()
                or not 0 < members[0].size <= MAX_BINARY_BYTES):
            raise ValueError("unsafe nextest archive members")
        with bundle.extractfile(members[0]) as source, output.open("xb") as target:
            size = copy_bounded(source, target, MAX_BINARY_BYTES)
        if size != members[0].size:
            raise ValueError("truncated nextest executable")
    output.chmod(0o700)


def verify_version(binary):
    result = subprocess.run([str(binary), "--version"], check=True,
                            capture_output=True, text=True,
                            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
    lines = result.stdout.splitlines()
    if (not lines or not lines[0].startswith(f"cargo-nextest {VERSION} (")
            or f"release: {VERSION}" not in lines
            or f"commit-hash: {COMMIT}" not in lines
            or "host: x86_64-unknown-linux-gnu" not in lines):
        raise ValueError("wrong nextest version, commit or target")
    print(result.stdout, end="", flush=True)


def install(destination, archive=None):
    destination = Path(destination)
    # mkdir must fail on every existing file, directory or symlink. On failure
    # below, remove only this successfully created invocation-owned leaf.
    destination.mkdir(mode=0o700)
    try:
        download = destination / "download.tar.gz"
        if archive is None:
            request = urllib.request.Request(URL, headers={"Accept": "application/octet-stream"})
            with urllib.request.urlopen(request, timeout=60) as source, download.open("xb") as target:
                copy_bounded(source, target, ARCHIVE_BYTES)
        else:
            archive = Path(archive)
            if not stat.S_ISREG(archive.lstat().st_mode):
                raise ValueError("nextest input archive must be regular")
            with archive.open("rb") as source, download.open("xb") as target:
                copy_bounded(source, target, ARCHIVE_BYTES)
        verify_archive(download)
        staged = destination / "verified-nextest"
        extract_binary(download, staged)
        verify_version(staged)
        binary = destination / "cargo-nextest"
        staged.rename(binary)
        download.unlink()
        print(f"nextest archive SHA256: {SHA256}", flush=True)
        return binary
    except BaseException:
        shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--archive", type=Path, help="local bytes; same immutable checksum required")
    args = parser.parse_args()
    print(install(args.destination, args.archive))


if __name__ == "__main__":
    main()
