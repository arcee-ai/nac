#!/usr/bin/env python3
"""Verify the release executable's offline Guide identity against preparation."""
import argparse
import json
import sys


def verify(value, version, source, track, build_id):
    expected = {"product_version": version, "source_revision": source,
                "track": track, "build_id": build_id}
    if value.get("provenance") != "first-party bundled NAC Guide":
        raise ValueError("release executable did not return the bundled Guide")
    if value.get("build_identity") != expected:
        raise ValueError("release Guide identity differs from the prepared candidate")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("version", "source", "track", "build-id"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("release Guide response exceeds the metadata bound")
    verify(json.loads(raw), args.version, args.source, args.track, args.build_id)
    print("Verified full release-local Guide identity for the prepared candidate")


if __name__ == "__main__":
    main()
