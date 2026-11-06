#!/usr/bin/env python3
"""Live official-manifest/advisory controls, separate from actual-image inventory."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re

from image_inventory import require, write_json
from image_rust import MANIFEST_PINS, digest, manifest_identities
from image_rust_advisories import advisory_records, query_rust, REPOSITORIES


def qualify_rust(output, download):
    output.mkdir()
    controls = {}
    for version in ("1.58.0", "1.58.1", "1.71.0", "1.71.1", "1.72.0", "1.98.0"):
        url = f"https://static.rust-lang.org/dist/channel-rust-{version}.toml"
        data, checksum = download(url), download(url + ".sha256")
        (output / f"{version}.toml").write_bytes(data)
        (output / f"{version}.toml.sha256").write_bytes(checksum)
        match = re.fullmatch(r"([0-9a-f]{64})  channel-rust-" + re.escape(version) + r"\.toml\n?", checksum.decode())
        require(match is not None, "malformed official Rust manifest checksum")
        require(version not in MANIFEST_PINS or MANIFEST_PINS[version] == match[1], "reviewed Rust manifest pin changed")
        _, identities = manifest_identities(data, version, match[1])
        controls[version] = {"distribution": version, "components": identities, "rustup": "1.29.0",
                             "url": url, "manifest_sha256": digest(data)}
    current = controls["1.98.0"]
    query_rust(current, output)
    queries = json.loads((output / "rust-advisory-queries.json").read_text())
    feeds = {repo: [] for repo in REPOSITORIES}
    for query in queries:
        repo = query["url"].split("/")[5]
        raw = (output / query["file"]).read_bytes()
        require(digest(raw) == query["sha256"], "Rust qualification feed changed")
        feeds[repo] += json.loads(raw)
    outcomes = {}
    for version, coverage in controls.items():
        matches = []
        for repo, records in feeds.items():
            _, found = advisory_records(repo, records, coverage)
            matches += found
        write_json(output / f"{version}-findings.json", matches)
        outcomes[version] = {"cargo_source": coverage["components"]["cargo"]["version"],
                             "advisories": sorted({f["advisory"] for f in matches})}
    std, cargo_source, cargo_binary = "GHSA-r9cc-f5pr-p3j2", "GHSA-j3xp-wfr4-hx87", "GHSA-wrrj-h57r-vx9p"
    for version, advisory, affected in (("1.58.0", std, True), ("1.58.1", std, False),
        ("1.71.0", cargo_source, True), ("1.71.1", cargo_source, True), ("1.72.0", cargo_source, False),
        ("1.71.0", cargo_binary, True), ("1.72.0", cargo_binary, False), ("1.98.0", cargo_source, False),
        ("1.98.0", cargo_binary, False)):
        require((advisory in outcomes[version]["advisories"]) == affected,
                f"official Rust live control drift: {version} {advisory}; retain raw evidence and investigate")
    write_json(output / "qualification.json", {"qualified_at": dt.datetime.now(dt.timezone.utc).isoformat(),
               "controls": outcomes, "scope": "public upstream machine metadata and official manifest identities; no image clearance"})
    return outcomes


if __name__ == "__main__":
    from image_scan import download
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    qualify_rust(parser.parse_args().output, download)
