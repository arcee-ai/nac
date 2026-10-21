"""Strict managed-image inventory/scan evidence validation (no policy exceptions)."""
import base64
import datetime as dt
import hashlib
import json
import re
import shlex


class EvidenceError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def timestamp(value):
    require(isinstance(value, str), "missing UTC timestamp")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "timestamp needs timezone")
    return parsed


def database(status, now):
    require(isinstance(status, dict) and status.get("error") is None, "database error")
    require(status.get("valid") is True, "database unavailable/invalid")
    age = (now - timestamp(status.get("built"))).total_seconds()
    require(0 <= age <= 86400, f"database built age outside 0..24h: {age}")
    require(status.get("schemaVersion") and status.get("path"), "database metadata missing")
    return {"built": status["built"], "age_seconds": age, "schema": status["schemaVersion"]}


def runtimes(raw):
    require(isinstance(raw, dict) and set(raw) == {"node", "go", "uv", "dpkg", "nac", "os_release"},
            "incomplete runtime probe")
    versions = {}
    patterns = {"node": r"v(\d+\.\d+\.\d+)",
                "go": r"go version go(\d+\.\d+\.\d+) linux/amd64",
                "uv": r"uv (\d+\.\d+\.\d+)(?: \([^\n]+\))?"}
    for name, pattern in patterns.items():
        match = re.fullmatch(pattern, raw[name].strip())
        require(match is not None, f"missing/unrecognized {name} runtime: {raw[name]!r}")
        versions[name] = match[1]
    packages = []
    for line in raw["dpkg"].splitlines():
        fields = line.split("\t")
        require(len(fields) == 2 and all(fields), "malformed dpkg inventory")
        packages.append(tuple(fields))
    require(packages, "empty OS package inventory")
    return versions, packages


def supported_debian(name, version):
    require(name == "debian" and isinstance(version, str) and
            re.fullmatch(r"12(?:\.\d+)?", version) is not None,
            "unrecognized/unsupported Debian release; OS advisory coverage is incomplete")


def os_release(raw):
    require(isinstance(raw, str), "missing actual Debian OS release probe")
    values = {}
    for line in raw.splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {"ID", "VERSION_ID", "VERSION_CODENAME"}:
            require(key not in values, f"duplicate OS release field: {key}")
            parsed = shlex.split(value)
            require(len(parsed) == 1, f"malformed OS release field: {key}")
            values[key] = parsed[0]
    supported_debian(values.get("ID"), values.get("VERSION_ID"))
    require(values.get("VERSION_ID") == "12" and values.get("VERSION_CODENAME") == "bookworm",
            "actual Debian OS release does not match supported bookworm image")
    return values


def inventory(sbom, raw, image):
    require(sbom.get("descriptor", {}).get("name") == "syft", "not Syft JSON")
    source = sbom.get("source", {})
    require(source.get("type") == "image", "SBOM is not an image inventory")
    metadata = source.get("metadata", {})
    if metadata.get("imageID") != image:
        # Containerd's loaded image ID can be the OCI manifest digest. Syft
        # normalizes that manifest but retains the exact requested ID and config.
        require(metadata.get("userInput") == image, "SBOM image identity mismatch")
        config = base64.b64decode(metadata.get("config", ""), validate=True)
        require(config and "sha256:" + hashlib.sha256(config).hexdigest() == metadata.get("imageID"),
                "SBOM config identity mismatch")
    artifacts = sbom.get("artifacts")
    require(isinstance(artifacts, list) and artifacts, "empty/missing Syft inventory")
    versions, packages = runtimes(raw)
    actual_distro = os_release(raw["os_release"])
    distro = sbom.get("distro", {})
    supported_debian(distro.get("id"), distro.get("versionID"))
    require(distro.get("versionCodename") == actual_distro["VERSION_CODENAME"],
            "SBOM Debian release differs from actual image OS release")
    debs = {(p.get("name"), p.get("version")) for p in artifacts if p.get("type") == "deb"}
    for name, version in packages:
        require((name.split(":")[0], version) in debs, f"OS package not inventoried: {name}@{version}")
    nodes = [p for p in artifacts if p.get("name") == "node" and
             p.get("version", "").lstrip("v") == versions["node"]]
    require(nodes, "Node binary missing/mismatched in Syft inventory")
    require(any(any("a:nodejs:node.js:" in (c if isinstance(c, str) else c.get("cpe", ""))
                        for c in p.get("cpes", [])) for p in nodes), "Node advisory CPE missing")
    return {"versions": versions, "os_release": actual_distro, "os_packages": len(packages),
            "node_artifact_ids": [p["id"] for p in nodes],
            "go": "explicit Go stdlib and toolchain OSV queries", "uv": "explicit PyPI uv OSV query"}


def grype_findings(report, sbom):
    require(isinstance(report, dict) and isinstance(report.get("matches"), list),
            "malformed scanner results")
    require(report.get("descriptor", {}).get("name") == "grype", "not Grype results")
    distro = report.get("distro", {})
    supported_debian(distro.get("name"), distro.get("version"))
    known = {p["id"] for p in sbom["artifacts"]}
    findings = []
    for match in report["matches"]:
        package, vuln = match["artifact"], match["vulnerability"]
        require(package.get("id") in known, "scanner returned unknown package")
        severity = vuln.get("severity")
        require(severity in {"Negligible", "Low", "Medium", "High", "Critical", "Unknown"},
                "unrecognized finding severity")
        findings.append({"advisory": vuln["id"],
                         "package": f"{package['type']}:{package['name']}",
                         "context": "managed-image", "version": package["version"],
                         "severity": severity, "source": "grype",
                         "fixed": vuln.get("fix", {}).get("versions", [])})
    return findings


def osv_findings(response, name, ecosystem, version):
    require(isinstance(response, dict) and set(response).issubset({"vulns"}),
            "malformed advisory response")
    vulns = response.get("vulns", [])  # OSV's documented no-match response is {}.
    require(isinstance(vulns, list), "malformed advisory list")
    findings = []
    for vuln in vulns:
        require(vuln.get("id") and isinstance(vuln.get("affected"), list), "malformed advisory")
        require(any(a.get("package", {}).get("name") == name and
                    a["package"].get("ecosystem") == ecosystem for a in vuln["affected"]),
                "advisory package mismatch")
        if vuln.get("withdrawn"):
            continue
        severity = vuln.get("database_specific", {}).get("severity", "UNKNOWN").upper()
        severity = {"MODERATE": "Medium", "LOW": "Low", "HIGH": "High",
                    "CRITICAL": "Critical", "UNKNOWN": "Unknown"}.get(severity)
        require(severity is not None, "unrecognized advisory severity")
        findings.append({"advisory": vuln["id"], "package": f"{ecosystem}:{name}",
                         "context": "managed-image", "version": version,
                         "severity": severity, "source": "osv-runtime", "fixed": [
                             e["fixed"] for a in vuln["affected"] for r in a.get("ranges", [])
                             for e in r.get("events", []) if "fixed" in e
                             and a.get("package", {}).get("name") == name
                             and a["package"].get("ecosystem") == ecosystem]})
    return findings


def write_json(path, document):
    path.write_text(json.dumps(document, indent=2) + "\n")


def write_report(path, result, image):
    blocking, excepted, reporting = (result[key] for key in ("blocking", "excepted", "reporting"))
    rows = ["# Managed image security", "", f"Image: `{image}`", "",
            f"Blocking: {len(blocking)}; excepted: {len(excepted)}; lower severity: {len(reporting)}.", "",
            "| Disposition | Advisory | Package | Installed | Severity | Fixed versions |",
            "| --- | --- | --- | --- | --- | --- |"]
    total = [("BLOCK", f) for f in blocking] + [("excepted", f) for f in excepted] + [("report", f) for f in reporting]
    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    for disposition, finding in total[:200]:
        values = [disposition, finding["advisory"], finding["package"], finding["version"],
                  finding["severity"], ", ".join(finding.get("fixed", [])) or "none published"]
        rows.append("| " + " | ".join(cell(value) for value in values) + " |")
    if len(total) > 200:
        rows += ["", "Table limited to 200 rows; all findings remain in findings.json/policy-result.json."]
    rows += ["", "Remediate the exact installed package/runtime, or land a separately reviewed narrow expiring",
             "exception through the shared source-security policy. Infrastructure/inventory failures cannot",
             "be excepted. Daily scans do not revoke older PR results; rerun stale candidates.", ""]
    path.write_text("\n".join(rows))
