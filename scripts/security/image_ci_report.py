#!/usr/bin/env python3
"""Report complete image findings during the explicitly deferred enforcement stage."""
import argparse
import json
from pathlib import Path
import re
import sys

from image_inventory import require, sha256, write_json
from image_rust import RUST_FILES
import image_applicability_bundle as applicability_bundle
from image_applicability_gate import validated_decision


def report(directory, scanner_exit, *, image=None, source_revision=None):
    # Only a completed security verdict is advisory. Scanner/inventory/tool/DB
    # errors, cancellation, missing evidence and partial output still fail CI.
    require(scanner_exit in {0, 1}, f"image scanner did not complete: exit {scanner_exit}")
    result = json.loads((directory / "result.json").read_text())
    identity = json.loads((directory / "identity.json").read_text())
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", identity.get("image", "")) and
            re.fullmatch(r"[0-9a-f]{40}", identity.get("source_revision", "")),
            "invalid completed image identity")
    require(result.get("image") == identity["image"] and
            (image is None or image == identity["image"]) and
            (source_revision is None or source_revision == identity["source_revision"]),
            "CI report differs from the scanned image/source")
    bundle = json.loads((directory / "bundle.json").read_text())
    expected_files = {"sbom.syft.json", "runtime.json", "identity.json", "coverage.json", *RUST_FILES}
    if bundle.get("schema_version") == 3:
        expected_files |= applicability_bundle.files(identity)
    require(bundle.get("schema_version") in {2, 3} and bundle.get("image") == identity["image"] and
            set(bundle.get("files", {})) == expected_files,
            "incomplete image inventory bundle")
    require(all(sha256(directory / name) == digest for name, digest in bundle["files"].items()),
            "CI report inventory was altered")
    policy = json.loads((directory / "policy-result.json").read_text())
    require(all(isinstance(policy.get(key), list) for key in ("blocking", "excepted", "reporting")),
            "incomplete image policy result")
    count = sum(len(policy[key]) for key in ("blocking", "excepted", "reporting"))
    findings = json.loads((directory / "findings.json").read_text())
    require(isinstance(findings, list) and len(findings) == count and
            type(result.get("findings")) is int and result["findings"] == count and
            type(result.get("blocking")) is int,
            "CI report finding counts differ")
    blocking = len(policy["blocking"])
    has_applicability = "applicability" in result
    require(has_applicability == (directory / "decision.json").is_file() ==
            (directory / "applicability-result.json").is_file(), "incomplete applicability decision")
    if has_applicability:
        decision = validated_decision(directory, findings, policy, identity)
        require(result.get("decision_sha256") == sha256(directory / "decision.json"),
                "scanner applicability decision changed")
        receipt = json.loads((directory / "applicability-result.json").read_text())
        require(result["applicability"] == receipt["status"], "scanner applicability status changed")
        blocking = len(decision["blocking_indexes"])
    require(result["blocking"] == blocking, "CI report effective blocking count differs")
    expected = "blocked" if blocking else "passed"
    require(result.get("status") == expected and scanner_exit == (1 if blocking else 0),
            "scanner exit and security verdict disagree")
    require((directory / "report.md").is_file(), "completed image report missing")
    receipt = {"schema_version": 1, "enforcement": "deferred", "security_verdict": expected,
               "image": identity["image"], "source_revision": identity["source_revision"],
               "blocking": blocking, "findings": count,
               "result_sha256": sha256(directory / "result.json"),
               "notice": "CI reports image findings; success does not establish image security clearance."}
    write_json(directory / "ci-report.json", receipt)
    print(f"Image enforcement deferred: {receipt['blocking']} blocking records / {count} findings; "
          f"security verdict remains {expected}.")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-output", type=Path, required=True)
    parser.add_argument("--scanner-exit", type=int, required=True)
    parser.add_argument("--image")
    parser.add_argument("--source-revision")
    args = parser.parse_args()
    try:
        report(args.scan_output, args.scanner_exit, image=args.image, source_revision=args.source_revision)
    except Exception as error:
        print(f"image CI reporting failed: {error}", file=sys.stderr)
        sys.exit(2)
