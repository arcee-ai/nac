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
from image_upstreams import upstream_findings
from image_scan import (SYFT_CONFIG, command, download, install_tools, scanner_environment,
                        scan_sbom, query_runtimes)

# Official nodejs.org SHASUMS256.txt, checked 2026-10-21. Extract only the
# executable; we never execute the deliberately vulnerable fixture binary.
NODE = {
    "vulnerable": ("18.0.0", "ffe94f0a3804e186b53f9480f4ef3a0c9ec450d7da45526438f6d37be9f4d22e"),
    "safe": ("24.22.1", "6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"),
}


IMAGE_CONTROLS = {("binary:node", "CVE-2024-27983"), ("deb:libtasn1-6", "CVE-2025-13151")}
RUNTIME_CONTROLS = {("Go:stdlib", "GO-2026-6809"), ("Go:toolchain", "GO-2026-6601"),
                    ("Go:github.com/git-lfs/git-lfs/v3", "GO-2025-3390"),
                    ("Go:github.com/cli/cli/v2", "GO-2024-3269"),
                    ("PyPI:uv", "GHSA-hq85-5cpj-mr62")}
WOLFI_CONTROLS = {("apk:openssl", "CVE-2022-3602")}


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


def qualify_wolfi(output, tools, env):
    summaries = {}
    for label, version in (("vulnerable", "3.0.6-r0"), ("safe", "3.0.7-r0")):
        directory = output / ("wolfi-" + label)
        root = directory / "root"
        (root / "etc").mkdir(parents=True)
        (root / "etc/os-release").write_text('ID=wolfi\nVERSION_ID="20230201"\n')
        (root / "usr/lib/apk/db").mkdir(parents=True)
        # Parser/advisory fixtures, not a claim to contain an installed binary.
        # The real image separately requires exact equality with its APK DB.
        (root / "usr/lib/apk/db/installed").write_text(
            f"P:openssl\nV:{version}\nA:x86_64\no:openssl\nT:OpenSSL control\nL:Apache-2.0\n\n")
        config = directory / "syft.yaml"
        config.write_text(SYFT_CONFIG)
        sbom_path = directory / "sbom.syft.json"
        command([tools["syft"], "scan", f"dir:{root.resolve()}", "--config", config,
                 "-o", f"syft-json={sbom_path.resolve()}"], env=env, output=directory / "syft.txt")
        sbom = json.loads(sbom_path.read_text())
        require(any(p["name"] == "openssl" and p["version"] == version and p["type"] == "apk"
                    for p in sbom["artifacts"]), "Wolfi APK fixture not detected by Syft")
        report = scan_sbom(tools, sbom_path, directory, env)
        findings = grype_findings(report, sbom)
        write_json(directory / "findings.json", findings)
        controls = qualify_controls(label, findings, WOLFI_CONTROLS)
        if label == "vulnerable":
            require(any(m["vulnerability"]["id"] == "CVE-2022-3602" and any(
                d.get("searchedBy", {}).get("namespace") == "wolfi:distro:wolfi:rolling"
                for d in m.get("matchDetails", [])) for m in report["matches"]),
                "Wolfi advisory namespace did not match the vulnerable APK control")
        summaries[label] = {"version": version, "findings": len(findings), **controls}
    return summaries


def qualify_upstreams(output, tools, env):
    summaries = {}
    fixtures = [
        ("cpes", "cpe:2.3:a:cyrusimap:cyrus-sasl:{}:*:*:*:*:*:*:*", "2.1.27", "2.1.28",
         ("upstream:cyrusimap/cyrus-sasl", "CVE-2022-24407")),
        ("purl", "pkg:apk/wolfi/openssl@{}?distro=wolfi-20230201", "3.0.6", "3.0.8",
         ("upstream-wolfi:openssl", "CVE-2022-3602"))]
    for scheme, template, vulnerable, safe, control in fixtures:
        summaries[scheme] = {}
        for label, version in (("vulnerable", vulnerable), ("safe", safe)):
            directory = output / f"upstream-{scheme}-{label}"
            directory.mkdir()
            path = directory / "inputs.txt"
            targets = {"fixture": template.format(version)}
            path.write_text(targets["fixture"] + "\n")
            report = scan_sbom(tools, path, directory, env, target=f"{scheme}:{path.resolve()}")
            require(report.get("source") == {"type": "sbom-file", "target": str(path.resolve())},
                    "upstream fixture source mismatch")
            findings = upstream_findings(report, targets, wolfi=scheme == "purl")
            write_json(directory / "findings.json", findings)
            summaries[scheme][label] = {"version": version, "findings": len(findings),
                                       **qualify_controls(label, findings, {control})}
    return summaries


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
        # Keep the known Bookworm advisory controls stable. Current Trixie
        # coverage is exercised by inventory tests and the exact native image.
        (root / "etc/os-release").write_text('ID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n')
        (root / "var/lib/dpkg").mkdir(parents=True)
        # Minimal dpkg records are parser/advisory fixtures, not real image inventories.
        name, package_version = ("libtasn1-6", "4.19.0-2") if label == "vulnerable" else ("base-files", "12.4+deb12u12")
        (root / "var/lib/dpkg/status").write_text(
            f"Package: {name}\nStatus: install ok installed\nArchitecture: amd64\nVersion: {package_version}\n\n")
        sbom_path = directory / "sbom.syft.json"
        config = directory / "syft.yaml"
        config.write_text(SYFT_CONFIG)
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
    from image_rust_qualify import qualify_rust
    rust_summary = qualify_rust(output / "rust-official-controls", download)
    runtime_summary = {}
    for label, versions in [("vulnerable", {"go": "1.27.0", "uv": "0.12.1", "git_lfs": "3.6.0"}),
                            ("safe", {"go": "1.27.3", "uv": "0.13.4", "git_lfs": "3.8.0"})]:
        versions["gh"] = "2.0.0" if label == "vulnerable" else "2.103.0"
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
               "fixtures": summaries, "wolfi_apk": qualify_wolfi(output, tools, env),
               "owned_upstream_queries": qualify_upstreams(output, tools, env),
               "runtime_version_queries": runtime_summary, "rust_official_controls": rust_summary,
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
