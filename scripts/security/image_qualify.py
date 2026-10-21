#!/usr/bin/env python3
"""Live Syft/Grype fixture qualification; downloads data/binaries, never builds an image."""
import argparse
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

from image_inventory import grype_findings, require, write_json
from image_scan import command, download, install_tools, scanner_environment, scan_sbom

# Official nodejs.org SHASUMS256.txt, checked 2026-10-21. Extract only the
# executable; we never execute the deliberately vulnerable fixture binary.
NODE = {
    "vulnerable": ("18.0.0", "ffe94f0a3804e186b53f9480f4ef3a0c9ec450d7da45526438f6d37be9f4d22e"),
    "safe": ("24.22.1", "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"),
}


def qualify(output, cache, db):
    output.mkdir(parents=True, exist_ok=False)
    tools, pins = install_tools(cache)
    write_json(output / "tools.json", pins)
    env = scanner_environment(db)
    summaries = {}
    for label, (version, digest) in NODE.items():
        directory = output / label
        root = directory / "root"
        (root / "usr/local/bin").mkdir(parents=True)
        archive = download(f"https://nodejs.org/dist/v{version}/node-v{version}-linux-x64.tar.xz")
        require(hashlib.sha256(archive).hexdigest() == digest, "Node fixture checksum mismatch")
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:xz") as bundle:
            node = bundle.extractfile(f"node-v{version}-linux-x64/bin/node").read()
        (root / "usr/local/bin/node").write_bytes(node)
        (root / "etc").mkdir()
        (root / "etc/os-release").write_text('ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n')
        (root / "var/lib/dpkg").mkdir(parents=True)
        # Minimal dpkg records are parser/advisory fixtures, not real image inventories.
        name, package_version = ("libtasn1-6", "4.19.0-2") if label == "vulnerable" else ("base-files", "12.4+deb12u12")
        (root / "var/lib/dpkg/status").write_text(
            f"Package: {name}\nStatus: install ok installed\nArchitecture: amd64\nVersion: {package_version}\n\n")
        sbom_path = directory / "sbom.syft.json"
        config = directory / "syft.yaml"
        config.write_text("check-for-app-update: false\nexclude: []\n")
        command([tools["syft"], "scan", f"dir:{root.resolve()}", "--config", config,
                 "-o", f"syft-json={sbom_path.resolve()}"], env=env, output=directory / "syft.txt")
        sbom = json.loads(sbom_path.read_text())
        require(any(p["name"] == "node" and p["version"] == version for p in sbom["artifacts"]),
                "real Node executable was not detected by Syft")
        require(any(p["name"] == name and p["type"] == "deb" for p in sbom["artifacts"]),
                "OS fixture was not detected by Syft")
        findings = grype_findings(scan_sbom(tools, sbom_path, directory, env), sbom)
        write_json(directory / "findings.json", findings)
        blocking = [f for f in findings if f["severity"] in {"High", "Critical", "Unknown"}]
        if label == "vulnerable":
            require(any(f["package"] == "binary:node" for f in blocking), "vulnerable Node did not block")
            require(any(f["package"] == "deb:libtasn1-6" for f in blocking), "vulnerable OS fixture did not block")
        else:
            require(not blocking, "safe fixture now blocks; inspect new advisories, do not suppress the qualification")
        summaries[label] = {"node": version, "os": f"{name}@{package_version}",
                            "blocking": len(blocking), "findings": len(findings)}
    write_json(output / "qualification.json", {"qualified_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "fixtures": summaries, "scope": "real Node binary detection and live OS/Node advisory matching"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tool-cache", required=True, type=Path)
    parser.add_argument("--db-cache", required=True, type=Path)
    args = parser.parse_args()
    try:
        qualify(args.output, args.tool_cache, args.db_cache)
    except Exception as error:
        print(f"live image qualification failed: {error}", file=sys.stderr)
        sys.exit(1)
