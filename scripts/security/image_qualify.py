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
from image_scan import command, download, install_tools, scanner_environment, scan_sbom, query_runtimes

# Official nodejs.org SHASUMS256.txt, checked 2026-10-21. Extract only the
# executable; we never execute the deliberately vulnerable fixture binary.
NODE = {
    "vulnerable": ("18.0.0", "ffe94f0a3804e186b53f9480f4ef3a0c9ec450d7da45526438f6d37be9f4d22e"),
    "safe": ("24.22.1", "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"),
}


IMAGE_CONTROLS = {("binary:node", "CVE-2024-27983"), ("deb:libtasn1-6", "CVE-2025-13151")}
RUNTIME_CONTROLS = {("Go:stdlib", "GO-2026-6809"), ("Go:toolchain", "GO-2026-6601"),
                    ("PyPI:uv", "GHSA-hq85-5cpj-mr62")}


def qualify_controls(label, findings, controls):
    """Prove selected real advisory controls; unrelated fixture CVEs are report data."""
    observed = {(f["package"], f["advisory"]) for f in findings}
    if label == "safe":
        require(not controls.intersection(observed), "fixed fixture still matches a control advisory")
    else:
        blocking = {(f["package"], f["advisory"]) for f in findings
                    if f["severity"] in {"High", "Critical", "Unknown"}}
        require(controls.issubset(blocking), "vulnerable fixture did not block on every control advisory")
    if label == "safe" and observed - controls:
        print(f"Fixture drift: {len(observed - controls)} unrelated advisories retained; candidate policy remains full/fail-closed")
    return {"control_matches": len(controls.intersection(observed)),
            "other_advisories": len(observed - controls)}


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
        controls = qualify_controls(label, findings, IMAGE_CONTROLS)
        summaries[label] = {"node": version, "os": f"{name}@{package_version}",
                            "blocking": len(blocking), "findings": len(findings), **controls}
    unrecognized = output / "unknown-debian"
    unrecognized.mkdir()
    unknown_sbom = json.loads((output / "vulnerable/sbom.syft.json").read_text())
    unknown_sbom["artifacts"] = [p for p in unknown_sbom["artifacts"] if p["type"] == "deb"]
    unknown_sbom["distro"] = {"id": "debian", "version": "unknown", "versionID": "unknown"}
    write_json(unrecognized / "sbom.syft.json", unknown_sbom)
    unknown_report = scan_sbom(tools, unrecognized / "sbom.syft.json", unrecognized, env)
    try:
        grype_findings(unknown_report, unknown_sbom)
    except ValueError as error:
        require("Debian release" in str(error), "unexpected unrecognized-release failure")
    else:
        raise ValueError("unknown Debian release did not fail closed")
    write_json(unrecognized / "rejection.json", {"gate": "rejected unknown Debian release",
               "scanner_matches": len(unknown_report["matches"])})
    runtime_summary = {}
    for label, versions in [("vulnerable", {"go": "1.27.0", "uv": "0.12.1"}),
                            ("safe", {"go": "1.27.3", "uv": "0.13.4"})]:
        runtime_output = output / f"{label}-runtime-queries"
        runtime_output.mkdir()
        findings = query_runtimes({"versions": versions}, runtime_output)
        write_json(runtime_output / "findings.json", findings)
        controls = qualify_controls(label, findings, RUNTIME_CONTROLS)
        runtime_summary[label] = {"versions": versions, "findings": len(findings), **controls}
    unavailable = output / "unavailable-db.yaml"
    unavailable.write_text("db:\n  update-url: https://127.0.0.1:9\n  require-update-check: true\n"
                           "  max-update-check-frequency: 0s\n  update-available-timeout: 1s\n")
    try:
        command([tools["grype"], "db", "update", "--config", unavailable], env=env,
                output=output / "unavailable-db.txt", timeout=20)
    except ValueError as error:
        require("unable to update vulnerability database" in str(error), "unexpected DB-negative failure")
    else:
        raise ValueError("DB network failure did not fail closed")
    write_json(output / "qualification.json", {"qualified_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "fixtures": summaries, "runtime_version_queries": runtime_summary,
               "db_network_failure": "rejected with a cached young DB",
               "unknown_debian_release": "rejected independently of scanner exit/match count", "scope": "real Node binary detection and live OS/Node advisory matching"})


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
