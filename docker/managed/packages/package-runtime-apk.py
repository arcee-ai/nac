#!/usr/bin/env python3
"""Package the owned Kerberos/curl backports, retaining files and source identity."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile


def digest(path, algorithm="sha256"):
    return hashlib.new(algorithm, path.read_bytes()).hexdigest()


def archive(root):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for path in sorted(root.rglob("*")):
            name = str(path.relative_to(root))
            info = tar.gettarinfo(str(path), arcname=name)
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = "root"
            if path.is_symlink():
                info.pax_headers["APK-TOOLS.checksum.SHA1"] = hashlib.sha1(
                    str(path.readlink()).encode()).hexdigest()
            if path.is_file() and not path.is_symlink():
                info.pax_headers["APK-TOOLS.checksum.SHA1"] = digest(path, "sha1")
                with path.open("rb") as source:
                    tar.addfile(info, source)
            else:
                tar.addfile(info)
    return gzip.compress(data.getvalue(), mtime=0)


def package(name, owner, root, output, lock):
    spec = lock[owner]
    version = spec["package_version"]
    notices = root / "usr/share/licenses" / name
    notices.mkdir(parents=True, exist_ok=True)
    source = Path("/work") / owner
    notice_paths = ([Path("/work/downloads/gcc-COPYING3"), Path("/work/downloads/gcc-COPYING.RUNTIME")]
                    if owner == "gcc_headers" else [source / ("NOTICE" if owner == "krb5" else "COPYING")])
    for notice in notice_paths:
        (notices / notice.name).write_bytes(notice.read_bytes())
    if owner == "sasl":
        (notices / "ACKNOWLEDGEMENT").write_text(
            "This product includes software developed by Computing Services at Carnegie Mellon University "
            "(http://www.cmu.edu/computing/).\n")
    provenance = root / "usr/share/nac/package-provenance" / f"{name}.json"
    provenance.parent.mkdir(parents=True, exist_ok=True)
    installed = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            installed["/" + str(path.relative_to(root))] = {"symlink": str(path.readlink())}
        elif path.is_file():
            installed["/" + str(path.relative_to(root))] = {"sha256": digest(path)}
    provenance.write_text(json.dumps({"schema_version": 1, "supplier": "NAC", "package": name,
                                     **spec, "downloads": lock["downloads"],
                                     "installed_payload": installed}, indent=2) + "\n")
    # An owned downstream package revision is not an invented upstream release.
    # The original source version, fixes and supplier remain separately visible.
    purl = f"pkg:apk/nac/{name}@{version}?arch=x86_64"
    document = {
        "spdxVersion": "SPDX-2.3", "dataLicense": "CC0-1.0", "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"{name}-{version}",
        "documentNamespace": f"https://nac.invalid/sbom/{name}/{version}/{spec['source_commit']}",
        "creationInfo": {"created": "2026-10-22T00:00:00Z", "creators": ["Organization: NAC"]},
        "documentDescribes": ["SPDXRef-Package"],
        "packages": [{"name": name, "SPDXID": "SPDXRef-Package", "versionInfo": version,
                      "supplier": "Organization: NAC", "filesAnalyzed": False,
                      "downloadLocation": "NOASSERTION", "licenseDeclared": spec["license"],
                      "licenseConcluded": "NOASSERTION", "copyrightText": "NOASSERTION",
                      "sourceInfo": json.dumps(spec, sort_keys=True),
                      "externalRefs": [{"referenceCategory": "PACKAGE-MANAGER",
                                        "referenceType": "purl", "referenceLocator": purl}]},
                     {"name": spec["upstream_name"], "SPDXID": "SPDXRef-Source", "versionInfo": spec["version"],
                      "downloadLocation": lock["downloads"][spec["archive"]]["url"],
                      "filesAnalyzed": False, "licenseDeclared": spec["license"],
                      "licenseConcluded": "NOASSERTION", "copyrightText": "NOASSERTION"}],
        "relationships": [{"spdxElementId": "SPDXRef-Package", "relationshipType": "GENERATED_FROM",
                           "relatedSpdxElement": "SPDXRef-Source"}]}
    if owner == "sasl":
        document["hasExtractedLicensingInfos"] = [{
            "licenseId": "LicenseRef-CMU-SASL", "name": "CMU Cyrus SASL license",
            "extractedText": (source / "COPYING").read_text()}]
    sbom = root / "var/lib/db/sbom" / f"{name}-{version}.spdx.json"
    sbom.parent.mkdir(parents=True, exist_ok=True)
    sbom.write_text(json.dumps(document, indent=2) + "\n")
    payload = archive(root)
    needed, sonames = set(), set()
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink() or path.read_bytes()[:4] != b"\x7fELF":
            continue
        dynamic = subprocess.check_output(["readelf", "-d", str(path)], text=True)
        needed.update(re.findall(r"\(NEEDED\).*?\[(.*?)\]", dynamic))
        sonames.update(re.findall(r"\(SONAME\).*?\[(.*?)\]", dynamic))
    deps = [f"so:{value}" for value in sorted(needed - sonames)]
    deps += {"krb5-libs": ["krb5-conf"], "libcurl-openssl4": [], "cyrus-sasl-heimdal-libs": [],
             "libssh2": [],
             "libstdc++-dev": ["so:libstdc++.so.6"],
             "curl": [f"libcurl-openssl4={version}"]}[name]
    provides = [f"so:{value}={value.rsplit('.', 1)[-1]}" for value in sorted(sonames)]
    if name == "libcurl-openssl4":
        provides.append("libcurl-abi=8.23.0")
    if name == "cyrus-sasl-heimdal-libs":
        provides.append("cyrus-sasl-libs=2.1.28")
    if name == "libstdc++-dev":
        provides.append(f"libstdc++-16-dev={version}")
    size = sum(p.stat().st_size for p in root.rglob("*") if p.is_file() and not p.is_symlink())
    fields = [f"pkgname = {name}", f"pkgver = {version}", "arch = x86_64",
              f"pkgdesc = NAC owned upstream {owner} build; see retained source provenance",
              f"url = {spec['project_url']}",
              f"license = {spec['license']}", f"origin = {spec['upstream_name']}", "maintainer = NAC",
              f"commit = {spec['source_commit']}", "builddate = 1792627200", f"size = {size}",
              f"datahash = {hashlib.sha256(payload).hexdigest()}"]
    fields += [f"depend = {dep}" for dep in deps]
    fields += [f"provides = {value}" for value in provides]
    control = io.BytesIO()
    with tarfile.open(fileobj=control, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        value = ("\n".join(fields) + "\n").encode()
        info = tarfile.TarInfo(".PKGINFO")
        info.size, info.mode = len(value), 0o644
        tar.addfile(info, io.BytesIO(value))
        # Only the final APK data segment has tar end markers. A control
        # trailer would make APK stop before reading the following payload.
        control_size = tar.offset
    apk = output / f"{name}-{version}.apk"
    apk.write_bytes(gzip.compress(control.getvalue()[:control_size], mtime=0) + payload)
    subprocess.run(["apk", "--no-network", "--repositories-file", "/dev/null",
                    "verify", "--allow-untrusted", str(apk)], check=True)
    print(apk, digest(apk), flush=True)


if __name__ == "__main__":
    lock = json.loads(Path(sys.argv[1]).read_text())
    output = Path("/out")
    output.mkdir(exist_ok=True)
    for name, owner in [("krb5-libs", "krb5"), ("libcurl-openssl4", "curl"), ("curl", "curl"),
                        ("cyrus-sasl-heimdal-libs", "sasl"), ("libstdc++-dev", "gcc_headers"),
                        ("libssh2", "libssh2")]:
        package(name, owner, Path("/packages") / name, output, lock)
