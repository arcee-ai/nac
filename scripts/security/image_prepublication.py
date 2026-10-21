#!/usr/bin/env python3
"""Fresh dev-smoke/security gate for an exact local candidate; never publishes."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from image_inventory import require, sha256, write_json
from image_scan import ROOT, command


def gate(args):
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", args.image), "publication requires an immutable local image ID")
    # The same identity is passed to every container operation. No second build,
    # mutable tag lookup, release publication, or registry push occurs here.
    env = dict(os.environ, MANAGED_IMAGE=args.image, MANAGED_IMAGE_SKIP_BUILD="1", CONTAINER_RUNTIME="docker")
    command(["sh", ROOT / "scripts/smoke-managed-image.sh"], env=env, timeout=600)
    result = subprocess.run(["python3", str(ROOT / "scripts/security/image_scan.py"),
                             "--image", args.image, "--source-revision", args.source_revision,
                             "--trusted-policy", str(args.trusted_policy),
                             "--candidate-policy", str(args.candidate_policy), "--output", str(args.output)])
    require(result.returncode == 0, "publication blocked by failed/incomplete image security")
    evidence = json.loads((args.output / "result.json").read_text())
    require(evidence["status"] == "passed" and evidence["image"] == args.image, "publication evidence mismatch")
    write_json(args.output / "publication-gate.json", {"image": args.image,
               "source_revision": args.source_revision, "scanned_at": evidence["scanned_at"],
               "result_sha256": sha256(args.output / "result.json"),
               "instruction": "Only this local image ID may be tagged/pushed immediately after this gate."})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--trusted-policy", required=True, type=Path)
    parser.add_argument("--candidate-policy", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        gate(args)
    except Exception as error:
        print(f"prepublication gate failed closed: {error}", file=sys.stderr)
        sys.exit(1)
