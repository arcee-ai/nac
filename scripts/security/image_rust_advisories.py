"""Complete public Rust-project advisory feeds with explicit identity/range evidence."""
import datetime as dt
import json
import re
import urllib.request
import urllib.error
from urllib.parse import urlparse

from image_inventory import require, timestamp, write_json
from image_rust import digest

REPOSITORIES = {"rust": {"std": "rust-std", "rustc": "rustc", "Rust": "rust"},
                "cargo": {"cargo": "cargo"}, "rustup": {"rustup": "rustup"},
                "rustfmt": {"rustfmt": "rustfmt-preview"},
                "rust-clippy": {"clippy": "clippy-preview", "rust-clippy": "clippy-preview"}}
API = "https://api.github.com/repos/rust-lang/"


def version_tuple(value):
    require(isinstance(value, str) and re.fullmatch(r"\d+\.\d+(?:\.\d+)?", value),
            f"unsupported Rust advisory version: {value!r}")
    parts = tuple(int(p) for p in value.split("."))
    return parts + (0,) * (3 - len(parts))


def parse_range(value):
    require(isinstance(value, str) and value.strip(), "missing Rust advisory range")
    alternatives = []
    for clause in value.split("||"):
        bounds = []
        for expression in clause.split(","):
            match = re.fullmatch(r"\s*(<=|>=|<|>|=)?\s*(\d+\.\d+(?:\.\d+)?)\s*", expression)
            require(match is not None, f"unsupported Rust advisory range: {value}")
            require(match[2].count(".") == 2 or match[1] in {"<", ">="},
                    "ambiguous partial Rust advisory comparator")
            bounds.append((match[1] or "=", version_tuple(match[2])))
        require(len({version[0] for _, version in bounds}) == 1,
                "ambiguous mixed-major Rust advisory range")
        lower = max((v for op, v in bounds if op in {">", ">=", "="}), default=None)
        upper = min((v for op, v in bounds if op in {"<", "<=", "="}), default=None)
        require(lower is None or upper is None or lower < upper or
                lower == upper and in_bounds(lower, bounds), "empty/contradictory Rust advisory range")
        alternatives.append(bounds)
    return alternatives


def in_bounds(version, bounds):
    return all({"<": version < boundary, "<=": version <= boundary, "=": version == boundary,
                ">=": version >= boundary, ">": version > boundary}[operator]
               for operator, boundary in bounds)


def advisory_records(repo, records, coverage):
    require(repo in REPOSITORIES and isinstance(records, list), "malformed Rust advisory feed")
    normalized, findings = [], []
    ids = set()
    for record in records:
        require(isinstance(record, dict), "malformed Rust advisory record")
        advisory = record.get("ghsa_id")
        require(isinstance(advisory, str) and re.fullmatch(r"GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2}", advisory),
                "missing/malformed Rust advisory identity")
        require(advisory not in ids, "duplicate Rust advisory")
        ids.add(advisory)
        require(record.get("state") in {"published", "withdrawn"} and isinstance(record.get("html_url"), str) and
                record["html_url"] == f"https://github.com/rust-lang/{repo}/security/advisories/{advisory}",
                "Rust advisory source/state mismatch")
        for name in ("published_at", "updated_at"):
            timestamp(record.get(name))
        withdrawn = record.get("withdrawn_at")
        require(record["state"] != "withdrawn" or withdrawn is not None,
                "withdrawn Rust advisory lacks withdrawal timestamp")
        if withdrawn is not None:
            timestamp(withdrawn)
        severity = record.get("severity")
        require(severity in {None, "unknown", "low", "medium", "high", "critical"},
                "unrecognized Rust advisory severity")
        severity = severity.title() if severity else "Unknown"
        vulnerabilities = record.get("vulnerabilities")
        require(isinstance(vulnerabilities, list) and vulnerabilities, "missing Rust advisory affected components")
        for affected in vulnerabilities:
            require(isinstance(affected, dict), "malformed Rust affected component")
            package = affected.get("package", {})
            name = package.get("name")
            require(name in REPOSITORIES[repo] and package.get("ecosystem") in {"rust", ""},
                    "unsupported/ambiguous Rust advisory component")
            component = REPOSITORIES[repo][name]
            ranges = parse_range(affected.get("vulnerable_version_range"))
            patched = affected.get("patched_versions")
            require("patched_versions" in affected and (patched is None or isinstance(patched, str)),
                    "malformed Rust advisory patched version metadata")
            # GitHub defines this as nullable report text, not an affected-version range.
            patched = patched or ""
            matched, evaluated = False, []
            for bounds in ranges:
                major = bounds[0][1][0]
                if component == "cargo":
                    require(major in {0, 1}, "unsupported Cargo advisory version namespace")
                    namespace = "source" if major == 0 else "distribution"
                    version = (coverage["components"]["cargo"]["version"] if major == 0 else coverage["distribution"])
                else:
                    namespace = "component"
                    version = coverage["rustup"] if component == "rustup" else coverage["components"][component]["version"]
                    require(major == version_tuple(version)[0], "unsupported Rust advisory version namespace")
                applies = in_bounds(version_tuple(version), bounds)
                evaluated.append({"namespace": namespace, "version": version, "bounds": bounds, "affected": applies})
                matched |= applies
            disposition = "withdrawn" if withdrawn else "affected" if matched else "not-affected"
            normalized.append({"advisory": advisory, "repository": "rust-lang/" + repo,
                "component": component, "severity": severity, "range": affected["vulnerable_version_range"],
                "patched_versions": patched, "evaluated": evaluated, "withdrawn_at": withdrawn,
                "disposition": disposition, "url": record["html_url"]})
            if matched and not withdrawn:
                # Prose never overrides contradictory upstream machine ranges.
                for identity in evaluated:
                    if identity["affected"]:
                        findings.append({"advisory": advisory, "package": "Rust:" + component,
                            "context": "managed-image", "version": identity["version"], "severity": severity,
                            "source": "rust-official:" + repo, "fixed": [patched] if patched else [],
                            "identity_namespace": identity["namespace"], "upstream_range": affected["vulnerable_version_range"]})
    return normalized, findings


def fetch_page(url):
    # Public-only request: no token, hidden drafts, ambient GitHub CLI or auth fallback.
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "NAC-managed-image-security"})
    try:
        response = urllib.request.urlopen(request, timeout=60)
    except urllib.error.HTTPError as error:
        response = error  # Retain failed HTTP bytes/headers before rejecting coverage.
    with response:
        require(response.url == url, "Rust advisory HTTP source mismatch")
        body = response.read(10 * 1024 * 1024 + 1)
        require(len(body) <= 10 * 1024 * 1024, "Rust advisory response exceeds bound")
        return body, {"http_status": response.status,
                      **dict((k.lower(), v) for k, v in response.headers.items())}


def next_page(link, url, repo, page):
    if not link:
        return None
    links = {}
    for entry in link.split(","):
        match = re.fullmatch(r'\s*<([^>]+)>; rel="(next|prev|first|last)"\s*', entry)
        require(match is not None and match[2] not in links, "malformed Rust advisory pagination")
        parsed = urlparse(match[1])
        require(parsed.scheme == "https" and parsed.netloc == "api.github.com" and
                parsed.path == f"/repos/rust-lang/{repo}/security-advisories", "foreign Rust advisory pagination")
        links[match[2]] = match[1]
    expected = API + repo + f"/security-advisories?per_page=100&page={page + 1}"
    require("next" not in links or links["next"] == expected, "incomplete Rust advisory pagination")
    if "last" in links and "next" not in links:
        require(links["last"] == url, "truncated Rust advisory pagination")
    return links.get("next")


def query_rust(coverage, output, *, fetch=fetch_page, now=None):
    require(isinstance(coverage, dict) and coverage.get("components"), "missing verified Rust identities")
    clock = lambda: now or dt.datetime.now(dt.timezone.utc)
    all_normalized, findings, receipts = [], [], []
    for repo in REPOSITORIES:
        records, page = [], 1
        url = API + repo + "/security-advisories?per_page=100&page=1"
        while url:
            require(page <= 100, "Rust advisory pagination exceeded bound")
            queried = clock()
            try:
                raw, headers = fetch(url)
            except Exception as error:
                write_json(output / "rust-advisory-error.json", {"url": url, "queried_at": queried.isoformat(),
                           "error": str(error), "complete": False})
                raise
            filename = f"rust-advisories-{repo}-{page}.json"
            (output / filename).write_bytes(raw)
            receipt = {"url": url, "queried_at": queried.isoformat(), "headers": headers,
                       "sha256": digest(raw), "file": filename}
            receipts.append(receipt)
            write_json(output / "rust-advisory-queries.json", receipts)
            require(headers.get("http_status") == 200, "Rust advisory HTTP status/auth/rate-limit failure")
            from email.utils import parsedate_to_datetime
            server_date = parsedate_to_datetime(headers.get("date", ""))
            require(server_date.tzinfo is not None and -300 <= (clock() - server_date).total_seconds() <= 86400,
                    "stale/future Rust advisory response")
            require(0 <= (clock() - queried).total_seconds() <= 86400, "expired Rust advisory query")
            require("application/json" in headers.get("content-type", ""), "unexpected Rust advisory response type")
            values = json.loads(raw)
            require(isinstance(values, list) and len(values) <= 100, "malformed Rust advisory response")
            following = next_page(headers.get("link"), url, repo, page)
            require(len(values) < 100 or following is not None, "possibly truncated Rust advisory feed")
            require(not following or len(values) == 100, "incomplete Rust advisory page")
            records += values
            url, page = following, page + 1
        normalized, matches = advisory_records(repo, records, coverage)
        all_normalized += normalized
        findings += matches
    write_json(output / "rust-advisories.json", {"queried_at": clock().isoformat(), "complete": True,
               "repositories": list(REPOSITORIES), "queries": receipts, "records": all_normalized})
    return findings
