#!/usr/bin/env python3
"""Retain actual installed APK archive, recipe, SPDX and notice evidence."""
from concurrent.futures import ThreadPoolExecutor
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request
import zlib


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def installed():
    records = []
    for block in Path("/lib/apk/db/installed").read_text().split("\n\n"):
        fields = dict(line.split(":", 1) for line in block.splitlines()
                      if len(line) > 1 and line[1] == ":")
        if fields.get("P"):
            records.append(fields)
    return records


def collect(package):
    name, version = package["P"], package["V"]
    output = Path("/usr/share/nac/vendor-package-metadata") / f"{name}-{version}"
    output.mkdir(parents=True, exist_ok=False)
    owned = Path("/usr/share/nac/runtime-package-build") / f"{name}-{version}.apk"
    if owned.is_file():
        archive = owned.read_bytes()
        location = str(owned)
        verification = "locally built; source/patch and archive hashes retained separately"
    else:
        location = f"https://apk.cgr.dev/chainguard/x86_64/{name}-{version}.apk"
        with urllib.request.urlopen(location, timeout=120) as response:
            archive = response.read(200 * 1024 * 1024 + 1)
        assert len(archive) <= 200 * 1024 * 1024, name
        verification = "exact installed APK identity from the normal trusted repository installation"
    segments, remaining = [], archive
    while remaining:
        decoder = zlib.decompressobj(31)
        plain = decoder.decompress(remaining, 512 * 1024 * 1024 + 1)
        assert decoder.eof and len(plain) <= 512 * 1024 * 1024, name
        consumed = len(remaining) - len(decoder.unused_data)
        assert consumed > 0, name
        segments.append((remaining[:consumed], plain))
        remaining = decoder.unused_data
    control_index, info = None, None
    for index, (compressed, plain) in enumerate(segments):
        with tarfile.open(fileobj=io.BytesIO(plain), mode="r:") as control:
            if ".PKGINFO" not in control.getnames():
                continue
            control_index = index
            info = control.extractfile(".PKGINFO").read().decode()
            identity = "Q1" + base64.b64encode(hashlib.sha1(compressed).digest()).decode()
            assert identity == package["C"], f"installed/archive identity differs: {name}"
            break
    assert control_index is not None and info is not None, name
    datahash = next(line.split(" = ", 1)[1] for line in info.splitlines() if line.startswith("datahash = "))
    assert datahash == sha256(b"".join(item[0] for item in segments[control_index + 1:])), name
    verification += "; installed control checksum and control-declared payload SHA256 verified"
    metadata = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz", ignore_zeros=True) as tar:
        for member in tar:
            if member.name not in {".PKGINFO", ".melange.yaml"}:
                continue
            assert member.isfile() and member.size <= 5 * 1024 * 1024, member.name
            data = tar.extractfile(member).read()
            target = output / member.name.lstrip(".")
            target.write_bytes(data)
            metadata[member.name] = {"path": str(target), "sha256": sha256(data)}
    assert ".PKGINFO" in metadata, name
    info = Path(metadata[".PKGINFO"]["path"]).read_text()
    assert f"pkgname = {name}\n" in info and f"pkgver = {version}\n" in info, name
    spdx = Path("/var/lib/db/sbom") / f"{name}-{version}.spdx.json"
    return {"name": name, "version": version, "installed_apk_fields": package,
            "archive": {"location": location, "sha256": sha256(archive), "verification": verification},
            "metadata": metadata,
            "vendor_spdx": {"path": str(spdx), "sha256": sha256(spdx.read_bytes())} if spdx.is_file() else None,
            "embedded_recipe_available": ".melange.yaml" in metadata}


if __name__ == "__main__":
    assert subprocess.check_output(["apk", "--print-arch"], text=True).strip() == "x86_64"
    repositories = Path("/etc/apk/repositories").read_text().strip()
    assert repositories == "https://apk.cgr.dev/chainguard", repositories
    packages = installed()
    raw_database = Path("/lib/apk/db/installed").read_bytes()
    retained_database = Path("/usr/share/nac/vendor-package-metadata/installed-apk-db.txt")
    retained_database.parent.mkdir(parents=True, exist_ok=True)
    retained_database.write_bytes(raw_database)
    with ThreadPoolExecutor(max_workers=4) as executor:
        evidence = sorted(executor.map(collect, packages), key=lambda record: record["name"])
    licenses = {}
    for directory in [Path("/usr/share/licenses"), Path("/usr/share/doc")]:
        for path in sorted(directory.rglob("*")):
            if path.is_file() and not path.is_symlink() and any(
                    value in path.name.lower() for value in ["license", "copying", "copyright", "notice", "acknowledgement"]):
                licenses[str(path)] = sha256(path.read_bytes())
    result = {"schema_version": 1, "os_release": Path("/etc/os-release").read_text(),
              "repositories": repositories, "packages": evidence, "notice_files": licenses,
              "installed_database": {"path": str(retained_database), "sha256": sha256(raw_database)},
              "qualification": "build/package provenance only; no vulnerability applicability verdict"}
    Path("/usr/share/nac/runtime-provenance.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"retained provenance for {len(evidence)} installed APK packages and {len(licenses)} notice files")
