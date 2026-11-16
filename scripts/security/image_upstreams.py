"""Conservative upstream matching independent of supplier APK revision numbers."""
import re

from image_inventory import require
from image_packages import PACKAGE_OWNERS

# Canonical NVD identities, independently of Wolfi origin names or APK -rN.
# These are search identities, never a list of advisories to discard.
UPSTREAM_CPES = {"krb5": ("mit", "kerberos_5"), "curl": ("haxx", "curl"),
                 "gcc_headers": ("gnu", "gcc"), "sasl": ("cyrusimap", "cyrus-sasl"),
                 "libssh2": ("libssh2", "libssh2")}
WOLFI_ORIGINS = {"krb5": "krb5", "curl": "curl", "gcc_headers": "gcc", "sasl": "cyrus-sasl",
                 "libssh2": "libssh2"}


def upstream_targets(coverage):
    owned = coverage.get("owned_runtime_packages")
    if owned is None:
        require(coverage.get("os_release", {}).get("ID") != "wolfi",
                "Wolfi upstream advisory inputs missing")
        return {}
    packages = owned.get("packages")
    require(isinstance(packages, dict) and set(packages) == set(PACKAGE_OWNERS),
            "incomplete owned upstream advisory inputs")
    targets = {}
    for name, owner in PACKAGE_OWNERS.items():
        version = packages[name].get("version")
        require(isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version),
                f"unsupported upstream version identity: {name}")
        vendor, product = UPSTREAM_CPES[owner]
        cpe = f"cpe:2.3:a:{vendor}:{product}:{version}:*:*:*:*:*:*:*"
        if owner in targets:
            require(targets[owner] == cpe, "split packages disagree on upstream version")
        targets[owner] = cpe
    require(set(targets) == set(UPSTREAM_CPES), "missing owned upstream search identity")
    return targets


def wolfi_upstream_targets(targets):
    # Search coordinates, NOT installed APK records. An upstream version with
    # no local -rN cannot inherit a supplier revision's fixed/not-affected status.
    # This intentionally over-reports fixes carried by supplier patch revisions.
    return {owner: f"pkg:apk/wolfi/{WOLFI_ORIGINS[owner]}@{cpe.split(':')[5]}?distro=wolfi-20230201"
            for owner, cpe in targets.items()}


def upstream_findings(report, targets, *, wolfi=False):
    require(isinstance(report, dict) and report.get("descriptor", {}).get("name") == "grype"
            and isinstance(report.get("matches"), list), "malformed upstream scanner results")
    distro = report.get("distro", {})
    require((distro.get("name"), distro.get("version")) ==
            (("wolfi", "20230201") if wolfi else ("", "")),
            "upstream scanner advisory namespace mismatch")
    expected = set(targets.values())
    findings = []
    for match in report["matches"]:
        artifact, vulnerability = match["artifact"], match["vulnerability"]
        if wolfi:
            purl = artifact.get("purl")
            require(purl in expected and artifact.get("type") == "apk",
                    "upstream scanner returned an unrequested Wolfi identity")
            name, version = purl.removeprefix("pkg:apk/wolfi/").split("?", 1)[0].split("@")
            package = f"upstream-wolfi:{name}"
        else:
            cpes = artifact.get("cpes")
            require(isinstance(cpes, list) and len(cpes) == 1 and cpes[0] in expected,
                    "upstream scanner returned an unrequested identity")
            fields = cpes[0].split(":")
            name, version = fields[4:6]
            package = f"upstream:{fields[3]}/{name}"
        require(artifact.get("name") == name and artifact.get("version") == version,
                "upstream scanner artifact version/name mismatch")
        severity = vulnerability.get("severity")
        require(severity in {"Negligible", "Low", "Medium", "High", "Critical", "Unknown"},
                "unrecognized upstream finding severity")
        require(isinstance(vulnerability.get("id"), str) and vulnerability["id"],
                "missing upstream advisory identity")
        findings.append({"advisory": vulnerability["id"],
                         "package": package,
                         "context": "managed-image", "version": version,
                         "severity": severity, "source": "grype-upstream",
                         "fixed": vulnerability.get("fix", {}).get("versions", [])})
    return findings
