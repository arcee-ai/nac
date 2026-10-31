#!/usr/bin/env python3
"""Compile/run Foundation-only ALL-350 fixtures; never launch an app or prompt."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    owner = Path(__file__).resolve().parent
    sources = [owner / name for name in ("AttentionObserver.swift", "AttentionObserverTests.swift")]
    compiler = subprocess.check_output(["xcrun", "--find", "swiftc"], text=True).strip()
    sdk = subprocess.check_output(["xcrun", "--sdk", "macosx", "--show-sdk-path"], text=True).strip()
    with tempfile.TemporaryDirectory(prefix="nac-attention-contract-") as temporary:
        binary = Path(temporary) / "attention-tests"
        subprocess.run([compiler, "-swift-version", "5", "-target", "arm64-apple-macosx14.0",
                        "-sdk", sdk, "-warnings-as-errors", *map(str, sources), "-o", str(binary)],
                       check=True, timeout=90)
        result = subprocess.run([str(binary)], check=True, capture_output=True, text=True, timeout=15)
        receipt = json.loads(result.stdout)
        receipt["source_revision"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=owner, text=True).strip()
        receipt["source_sha256"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                    for path in sources}
        receipt["binary_sha256"] = hashlib.sha256(binary.read_bytes()).hexdigest()
        receipt["compiler"] = subprocess.check_output(
            [compiler, "--version"], text=True, stderr=subprocess.STDOUT).strip()
        receipt["target"] = "arm64-apple-macosx14.0"
        receipt["sdk"] = sdk
        print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
