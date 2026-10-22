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
    require(isinstance(raw, dict) and set(raw) == {"node", "go", "uv", "gh", "git_lfs", "dpkg", "nac", "os_release"},
            "incomplete runtime probe")
    versions = {}
    patterns = {"node": r"v(\d+\.\d+\.\d+)",
                "go": r"go version go(\d+\.\d+\.\d+) linux/amd64",
                "uv": r"uv (\d+\.\d+\.\d+)(?: \([^\n]+\))?",
                "gh": r"gh version (\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)(?:\nhttps://github.com/cli/cli/releases/tag/v\1)?",
                "git_lfs": r"git-lfs/(\d+\.\d+\.\d+) \([^\n]+\)"}
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
    match = re.fullmatch(r"(12|13)(?:\.\d+)?", version) if isinstance(version, str) else None
    require(name == "debian" and match is not None,
            "unrecognized/unsupported Debian release; OS advisory coverage is incomplete")
    return match[1]


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
    major = supported_debian(values.get("ID"), values.get("VERSION_ID"))
    require(values.get("VERSION_ID") == major and
            values.get("VERSION_CODENAME") == {"12": "bookworm", "13": "trixie"}[major],
            "actual Debian OS release does not match a supported image")
    return values


GO_PIN_PATTERNS = {"GH_VERSION": r"\d+\.\d+\.\d+",
                   "GIT_LFS_VERSION": r"\d+\.\d+\.\d+",
                   "GIT_LFS_REVISION": r"[0-9a-f]{40}"}


def managed_go_pins(source):
    pins = {}
    for name, pattern in GO_PIN_PATTERNS.items():
        values = re.findall(rf"^ARG {name}=({pattern})$", source, re.MULTILINE)
        require(len(values) == 1, f"missing/ambiguous managed Go application pin: {name}")
        pins[name] = values[0]
    return pins


def inventory(sbom, raw, image, *, expected_pins):
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
    major = supported_debian(distro.get("id"), distro.get("versionID"))
    require(major == actual_distro["VERSION_ID"] and
            distro.get("versionCodename") == actual_distro["VERSION_CODENAME"],
            "SBOM Debian release differs from actual image OS release")
    debs = {(p.get("name"), p.get("version")) for p in artifacts if p.get("type") == "deb"}
    for name, version in packages:
        require((name.split(":")[0], version) in debs, f"OS package not inventoried: {name}@{version}")
    nodes = [p for p in artifacts if p.get("name") == "node" and
             p.get("version", "").lstrip("v") == versions["node"]]
    require(nodes, "Node binary missing/mismatched in Syft inventory")
    require(any(any("a:nodejs:node.js:" in (c if isinstance(c, str) else c.get("cpe", ""))
                        for c in p.get("cpes", [])) for p in nodes), "Node advisory CPE missing")
    applications = {}
    pins = expected_pins
    require(isinstance(pins, dict) and set(pins) == set(GO_PIN_PATTERNS),
            "missing/incomplete image-source Go application pins")
    for name, pattern in GO_PIN_PATTERNS.items():
        require(isinstance(pins[name], str) and re.fullmatch(pattern, pins[name]) is not None,
                f"malformed image-source Go application pin: {name}")
    for runtime, module, binary in [("gh", "github.com/cli/cli/v2", "/usr/local/bin/gh"),
                                    ("git_lfs", "github.com/git-lfs/git-lfs/v3", "/usr/local/bin/git-lfs")]:
        modules = [p for p in artifacts if p.get("type") == "go-module" and p.get("name") == module
                   and any(location.get("path") == binary for location in p.get("locations", []))]
        require(modules, f"{runtime} Go binary missing from Syft inventory")
        expected = versions[runtime]
        require(expected == pins["GH_VERSION" if runtime == "gh" else "GIT_LFS_VERSION"],
                f"{runtime} actual version differs from the managed image pin")
        for package in modules:
            version = package.get("version", "").removeprefix("v")
            # go build with a dependency overlay cannot stamp the main module's
            # release. Keep Syft's raw evidence; mandatory OSV queries below use
            # the actual executable's release instead of guessing binary strings.
            require(version == expected or runtime == "git_lfs" and version in {"UNKNOWN", "(devel)"},
                    f"{runtime} Go artifact version differs from actual binary")
            require(package.get("metadata", {}).get("mainModule") == module,
                    f"{runtime} artifact is not its executable's main Go module")
        applications[runtime] = {"module": module, "version": expected,
                                 "artifact_ids": [p["id"] for p in modules],
                                 "advisories": "explicit Go module OSV query plus Grype"}
        if runtime == "git_lfs":
            revision = re.search(r"; git ([0-9a-f]{40})\)$", raw[runtime].strip())
            require(revision is not None, "Git LFS source revision missing from actual binary")
            require(revision[1] == pins["GIT_LFS_REVISION"],
                    "Git LFS actual source revision differs from the managed image pin")
            applications[runtime]["source_revision"] = revision[1]
    return {"versions": versions, "os_release": actual_distro, "os_packages": len(packages),
            "node_artifact_ids": [p["id"] for p in nodes],
            "go_applications": applications,
            "go": "explicit Go stdlib and toolchain OSV queries", "uv": "explicit PyPI uv OSV query"}


def grype_findings(report, sbom):
    require(isinstance(report, dict) and isinstance(report.get("matches"), list),
            "malformed scanner results")
    require(report.get("descriptor", {}).get("name") == "grype", "not Grype results")
    distro = report.get("distro", {})
    major = supported_debian(distro.get("name"), distro.get("version"))
    require(major == supported_debian(sbom.get("distro", {}).get("id"),
                                      sbom.get("distro", {}).get("versionID")),
            "Grype Debian release differs from the inventoried image")
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
