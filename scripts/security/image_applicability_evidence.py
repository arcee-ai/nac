"""Passive exact-image curl/Kerberos evidence; never supplies a security verdict."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import struct
import tarfile

from image_inventory import require, sha256

PACKAGES = {"krb5-libs": "krb5", "curl": "curl", "libcurl-openssl4": "curl"}
PROFILE = "nac-curl-krb5-filesystem-v1"
FILESYSTEM_SCOPE = "final-underlying-image-filesystem"
LIMITATIONS = [
    "Named-path absence does not prove absence of renamed or embedded applications.",
    "ELF DT_NEEDED and shebang enumeration does not resolve dlopen, static linkage or runtime execution.",
    "Source/package integrity is not proof of applied-patch semantics or upstream regression acceptance.",
    "Candidate evidence is untrusted until independently qualified and human-reviewed; no finding is cleared.",
    "Export covers underlying image directories, never mounted volume contents or runtime-volume absence.",
]


def canonical_json(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def digest(value):
    return hashlib.sha256(canonical_json(value)).hexdigest()


def safe_path(value):
    require(isinstance(value, str) and value and "\x00" not in value, "invalid filesystem path")
    name = value.removeprefix("./").rstrip("/")
    require(name and not name.startswith("/") and str(PurePosixPath(name)) == name and
            ".." not in PurePosixPath(name).parts, "unsafe/noncanonical filesystem path")
    return "/" + name


def elf_profile(stream, size):
    """Read dynamic consumers without invoking any image binary or library."""
    stream.seek(0)
    header = stream.read(64)
    require(len(header) == 64 and header[:7] == b"\x7fELF\x02\x01\x01", "unsupported/truncated ELF profile")
    kind, machine = struct.unpack_from("<HH", header, 16)
    offset = struct.unpack_from("<Q", header, 32)[0]
    entry_size, count = struct.unpack_from("<HH", header, 54)
    require(machine == 62 and kind in {1, 2, 3} and (entry_size == 56 or count == offset == entry_size == 0) and count <= 1024 and
            offset + count * entry_size <= size, "unsupported/invalid ELF program headers")
    loads, dynamic = [], None
    for index in range(count):
        stream.seek(offset + index * entry_size)
        segment = struct.unpack("<IIQQQQQQ", stream.read(entry_size))
        typ, _, file_offset, address, _, file_size, _, _ = segment
        require(file_offset + file_size <= size, "ELF segment outside file")
        if typ == 1:
            loads.append((address, file_offset, file_size))
        if typ == 2:
            require(dynamic is None and file_size <= 1024 * 1024 and file_size % 16 == 0,
                    "ambiguous/oversized ELF dynamic table")
            dynamic = (file_offset, file_size)
    needed, strings, strings_size = [], None, None
    if dynamic:
        stream.seek(dynamic[0])
        terminated = False
        for tag, value in struct.iter_unpack("<qQ", stream.read(dynamic[1])):
            if tag == 0:
                terminated = True
                break
            if tag == 1:
                needed.append(value)
            if tag in {5, 10}:
                require((strings if tag == 5 else strings_size) is None, "duplicate ELF string table")
                if tag == 5:
                    strings = value
                else:
                    strings_size = value
        require(terminated, "unterminated ELF dynamic table")
    libraries = []
    if needed:
        require(strings is not None and strings_size is not None and 0 < strings_size <= 16 * 1024 * 1024,
                "missing/oversized ELF string table")
        mappings = [off + strings - address for address, off, length in loads
                    if address <= strings and strings + strings_size <= address + length]
        require(len(mappings) == 1, "unmapped/ambiguous ELF string table")
        stream.seek(mappings[0])
        table = stream.read(strings_size)
        for start in needed:
            end = table.find(b"\0", start) if start < len(table) else -1
            require(end > start, "invalid ELF DT_NEEDED string")
            name = table[start:end].decode("ascii")
            require("/" not in name and len(name) <= 255, "noncanonical ELF library name")
            libraries.append(name)
    return {"kind": "elf", "machine": "x86_64", "type": kind, "needed": sorted(libraries)}


def filesystem_profile(archive):
    """Inventory every final-export entry. No extraction, execution or omissions."""
    require(archive.is_file() and not archive.is_symlink() and
            1024 <= archive.stat().st_size <= 32 * 1024 ** 3 and archive.stat().st_size % 512 == 0,
            "missing/oversized/unframed filesystem export")
    entries, consumers, retained = {}, {}, {}
    with archive.open("rb") as raw:
        raw.seek(-1024, 2)
        require(raw.read() == bytes(1024), "truncated filesystem export trailer")
    with tarfile.open(archive, "r:") as bundle:
        for member in bundle:
            if member.name in {".", "./"} and member.isdir():
                continue
            path = safe_path(member.name)
            require(path not in entries and len(entries) < 500000 and not member.sparse,
                    "duplicate/oversized/sparse filesystem export")
            item = {"mode": member.mode, "uid": member.uid, "gid": member.gid}
            if member.isfile():
                item.update(type="file", size=member.size)
                with bundle.extractfile(member) as stream:
                    checksum, length = hashlib.sha256(), 0
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        checksum.update(chunk)
                        length += len(chunk)
                    require(length == member.size, "truncated filesystem payload")
                    item["sha256"] = checksum.hexdigest()
                    stream.seek(0)
                    start = stream.read(4096)
                    if start.startswith(b"\x7fELF"):
                        consumers[path] = elf_profile(stream, member.size)
                    elif start.startswith(b"#!"):
                        first = start.partition(b"\n")[0]
                        require(len(first) < 4096, "oversized script interpreter directive")
                        consumers[path] = {"kind": "script", "directive": first.decode("utf-8")}
                    elif member.mode & 0o111:
                        consumers[path] = {"kind": "opaque_executable"}
                    if path.startswith("/usr/share/nac/package-provenance/") or path == "/usr/share/nac/runtime-package-build/sources.lock.json":
                        require(member.size <= 16 * 1024 * 1024, "oversized retained package metadata")
                        stream.seek(0)
                        retained[path] = json.loads(stream.read())
            elif member.isdir():
                item["type"] = "directory"
            elif member.issym():
                require(member.linkname and "\x00" not in member.linkname, "invalid filesystem symlink")
                item.update(type="symlink", target=member.linkname)
            elif member.islnk():
                item.update(type="hardlink", target=safe_path(member.linkname))
            elif member.ischr() or member.isblk():
                item.update(type="character" if member.ischr() else "block", major=member.devmajor, minor=member.devminor)
            elif member.isfifo():
                item["type"] = "fifo"
            else:
                raise ValueError("unsupported filesystem export entry")
            entries[path] = item
        # tarfile normally accepts the first end marker, even with hidden tail.
        with archive.open("rb") as raw:
            raw.seek(bundle.offset)
            require(all(not any(chunk) for chunk in iter(lambda: raw.read(1024 * 1024), b"")),
                    "nonzero content after filesystem export terminator")
    require(entries, "empty filesystem export")
    for path, item in entries.items():
        parent = str(PurePosixPath(path).parent)
        require(parent == "/" or entries.get(parent, {}).get("type") == "directory",
                "missing/non-directory filesystem parent")
        if item["type"] == "hardlink":
            require(entries.get(item["target"], {}).get("type") == "file", "unresolved/nonregular hardlink")
            if item["target"] in consumers:
                consumers[path] = consumers[item["target"]]
    named = {"sudo": [], "ftpd": []}
    for path, item in entries.items():
        if item["type"] == "directory":
            continue
        name = PurePosixPath(path).name.lower()
        if name in {"sudo", "sudoedit", "sudoreplay"}:
            named["sudo"].append(path)
        if name in {"ftpd", "in.ftpd", "gssftpd", "gssftp"}:
            named["ftpd"].append(path)
    return ({"schema_version": 1, "profile": PROFILE, "scope": FILESYSTEM_SCOPE, "entries": dict(sorted(entries.items()))},
            {"schema_version": 1, "profile": PROFILE, "scope": FILESYSTEM_SCOPE, "entries": dict(sorted(consumers.items())),
             "named_applications": {key: sorted(paths) for key, paths in named.items()}}, retained)


def payload_signature(path, entries):
    require(isinstance(path, str) and path.startswith("/usr/") and safe_path(path[1:]) == path,
            "noncanonical owned payload path")
    item = entries.get(path)
    require(item is not None, "missing installed payload")
    if item["type"] == "hardlink":
        item = entries[item["target"]]
    if item["type"] == "file":
        return {"sha256": item["sha256"]}
    require(item["type"] == "symlink", "nonregular owned payload")
    target = item["target"]
    resolved = posixpath.normpath(target if target.startswith("/") else posixpath.join(posixpath.dirname(path), target))
    require(resolved.startswith("/usr/"), "owned payload symlink escapes /usr")
    seen = set()
    for _ in range(40):
        require(resolved not in seen, "cyclic owned payload symlink")
        seen.add(resolved)
        parts = PurePosixPath(resolved).parts
        for index in range(2, len(parts) + 1):
            prefix = str(PurePosixPath(*parts[:index]))
            value = entries.get(prefix)
            require(value is not None, "dangling owned payload symlink")
            if value["type"] == "symlink":
                tail = parts[index:]
                link = value["target"]
                resolved = posixpath.normpath(posixpath.join(
                    link if link.startswith("/") else posixpath.join(posixpath.dirname(prefix), link), *tail))
                require(resolved.startswith("/usr/"), "owned payload symlink chain escapes /usr")
                break
        else:
            require(entries[resolved]["type"] in {"file", "hardlink"}, "owned payload symlink is not a file")
            return {"symlink": target}
    raise ValueError("oversized owned payload symlink chain")


def subject_identity(image, source_revision, inspected):
    require(isinstance(image, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", image) and
            isinstance(source_revision, str) and re.fullmatch(r"[a-f0-9]{40}", source_revision),
            "invalid immutable image/source identity")
    require(isinstance(inspected, list) and len(inspected) == 1, "missing/ambiguous image inspection")
    actual = inspected[0]
    require(actual.get("Id") == image and actual.get("Os") == "linux" and actual.get("Architecture") == "amd64" and
            actual.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") == source_revision,
            "wrong image/source/platform")
    return {"image": image, "source_revision": source_revision, "platform": "linux/amd64"}


def export_container(image, inspected, container_inspected):
    """Bind a fresh, never-started export container; mounted data is out of scope."""
    volumes = inspected[0].get("Config", {}).get("Volumes")
    volumes = {} if volumes is None else volumes
    require(isinstance(volumes, dict) and all(
        isinstance(path, str) and path.startswith("/") and safe_path(path[1:]) == path and value == {}
        for path, value in volumes.items()), "malformed declared image volumes")
    declared = sorted(volumes)
    require(isinstance(container_inspected, list) and len(container_inspected) == 1,
            "missing/ambiguous export container inspection")
    container = container_inspected[0]
    state, host = container.get("State", {}), container.get("HostConfig", {})
    require(container.get("Image") == image and container.get("Config", {}).get("Image") == image and
            state.get("Status") == "created" and state.get("Running") is False and
            state.get("StartedAt") == "0001-01-01T00:00:00Z" and container.get("RestartCount") == 0,
            "export container differs from immutable image or was started")
    require(all(not host.get(key) for key in ("Binds", "Mounts", "Tmpfs", "VolumesFrom")),
            "export container has user-supplied mounts")
    mounts = container.get("Mounts")
    require(isinstance(mounts, list) and len(mounts) == len(declared) and
            sorted(mount.get("Destination", "") for mount in mounts) == declared and
            all(mount.get("Type") == "volume" and isinstance(mount.get("Name"), str) and
                re.fullmatch(r"[a-f0-9]{64}", mount["Name"]) for mount in mounts),
            "export mounts differ from declared anonymous image volumes")
    return declared


def collect_evidence(filesystem_archive, *, image, source_revision, inspected, container_inspected, pins, downloads):
    subject = subject_identity(image, source_revision, inspected)
    declared = export_container(image, inspected, container_inspected)
    filesystem, consumers, retained = filesystem_profile(Path(filesystem_archive))
    require(retained.get("/usr/share/nac/runtime-package-build/sources.lock.json") == pins,
            "installed source lock differs from reviewed image source")
    source_files, packages = {}, {}
    names = {value for owner in set(PACKAGES.values()) for value in [pins[owner]["archive"], *pins[owner]["patches"]]}
    require(set(downloads) == names, "missing/unknown source archive or patch evidence")
    for name in sorted(names):
        path, spec = Path(downloads[name]), pins["downloads"][name]
        require(path.is_file() and not path.is_symlink() and sha256(path) == spec["sha256"],
                "source archive/patch digest differs from reviewed lock")
        source_files[name] = spec
    for name, owner in PACKAGES.items():
        spec = pins[owner]
        record = retained.get(f"/usr/share/nac/package-provenance/{name}.json")
        expected = {"schema_version": 1, "supplier": "NAC", "package": name, **spec, "downloads": pins["downloads"]}
        require(isinstance(record, dict) and set(record) == {*expected, "installed_payload"} and
                all(record[key] == value for key, value in expected.items()), "owned package source/patch provenance mismatch")
        payload = record["installed_payload"]
        require(isinstance(payload, dict) and 0 < len(payload) <= 20000 and
                all(payload_signature(path, filesystem["entries"]) == signature for path, signature in payload.items()),
                "installed package payload differs from retained source record")
        patches = {patch: source_files[patch]["sha256"] for patch in spec["patches"]}
        packages[name] = {"upstream_version": spec["version"], "package_version": spec["package_version"],
                          "source_commit": spec["source_commit"], "source_sha256": source_files[spec["archive"]]["sha256"],
                          "patches_sha256": digest(patches), "payload_sha256": digest(payload)}
    provenance = {"schema_version": 1, "profile": PROFILE, "subject": subject,
                  "filesystem_scope": FILESYSTEM_SCOPE, "declared_volume_paths": declared,
                  "container_inspection_sha256": digest(container_inspected),
                  "filesystem_archive_sha256": sha256(Path(filesystem_archive)), "source_lock_sha256": digest(pins),
                  "source_downloads": source_files, "packages": packages,
                  "filesystem_sha256": digest(filesystem), "consumers_sha256": digest(consumers),
                  "application_profile_sha256": digest({"filesystem": digest(filesystem), "consumers": digest(consumers),
                                                        "filesystem_scope": FILESYSTEM_SCOPE, "declared_volume_paths": declared}),
                  "limitations": LIMITATIONS}
    return {"provenance": provenance, "filesystem": filesystem, "consumers": consumers}


def validate_evidence(evidence, filesystem_archive, **expected):
    """Recollect retained bytes with independent expected bindings; no JSON-only acceptance."""
    require(isinstance(evidence, dict) and set(evidence) == {"provenance", "filesystem", "consumers"},
            "missing/incomplete passive applicability evidence")
    actual = collect_evidence(filesystem_archive, **expected)
    require(evidence == actual, "changed/incomplete passive applicability evidence")
    return actual["provenance"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("filesystem", "inspect", "container-inspect", "pins", "downloads", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--source-revision", required=True)
    args = parser.parse_args()
    pins = json.loads(args.pins.read_text())
    names = {name for owner in set(PACKAGES.values()) for name in [pins[owner]["archive"], *pins[owner]["patches"]]}
    result = collect_evidence(args.filesystem, image=args.image, source_revision=args.source_revision,
                              inspected=json.loads(args.inspect.read_text()),
                              container_inspected=json.loads(args.container_inspect.read_text()), pins=pins,
                              downloads={name: args.downloads / name for name in names})
    args.output.mkdir(parents=True, exist_ok=False)
    for name, value in result.items():
        (args.output / (name + ".json")).write_bytes(canonical_json(value))


if __name__ == "__main__":
    main()
