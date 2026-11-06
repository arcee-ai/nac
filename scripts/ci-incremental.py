#!/usr/bin/env python3
"""Bounded compiler-only staging for the two existing NAC release targets.

This cache never supplies quality evidence. Rust/Cargo and the unchanged binary
identity/archive checks remain responsible for every current candidate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import tempfile
import tomllib

MODE = "nac-release-incremental-v1"
TARGETS = {"x86_64-unknown-linux-musl", "aarch64-apple-darwin"}
MAX_BYTES = 4 * 1024**3
MAX_FILE = 512 * 1024**2
MAX_FILES = 20_000
MAX_ENTRIES = 30_000
MAX_MANIFEST = 8 * 1024**2
RESERVE = 1024**3
UNIT = re.compile(r"(?:nac_(?:contracts|core|credential_store|managed|process|server|web)|build_script_build)-[a-z0-9]{1,64}")
SESSION = re.compile(r"s-[a-z0-9]{1,64}-[a-z0-9]{1,64}-[a-z0-9]{1,64}")
LOCK = re.compile(r"s-[a-z0-9]{1,64}-[a-z0-9]{1,64}\.lock")
OBJECT = re.compile(r"[a-z0-9]{1,64}\.(?:o|bc|pre-lto\.bc)")
DATA = {"dep-graph.bin", "query-cache.bin", "work-products.bin", "thin-lto-past-keys.bin", "metadata.rmeta"}
HEX = re.compile(r"[0-9a-f]{64}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(path):
    """Reject symlinks, including existing ancestors, before any filesystem use."""
    require(".." not in Path(path).parts, "parent path traversal")
    path = Path(os.path.abspath(path))
    for part in [*reversed(path.parents), path]:
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        require(not stat.S_ISLNK(info.st_mode), f"symlink path rejected: {part}")
    return path


def regular(path, limit=MAX_MANIFEST):
    """Read a bounded, nonlinked regular metadata file without following links."""
    canonical(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "metadata must be a private regular file")
        require(before.st_size <= limit, "metadata exceeds byte bound")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    require(len(data) <= limit and stable(before, after), "metadata changed while reading")
    return data


def stable(before, after):
    return (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)


def relative(value):
    require(isinstance(value, str) and len(value) <= 300, "invalid compiler path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and value == path.as_posix() and ".." not in path.parts, "noncanonical compiler path")
    parts = path.parts
    require(len(parts) in (2, 3) and UNIT.fullmatch(parts[0]), "unexpected compiler unit path")
    if len(parts) == 2:
        require(LOCK.fullmatch(parts[1]), "unexpected compiler lock path")
    else:
        require(SESSION.fullmatch(parts[1]) and (parts[2] in DATA or OBJECT.fullmatch(parts[2])), "unexpected compiler work product")
    return path


def open_tree(root, parts=()):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def inventory(root, private=False):
    """Only Rust 1.98 compiler files, depth <=3, never links/special files."""
    root = canonical(root)
    result = []
    total = 0
    entries_seen = 0

    def visit(fd, parts):
        nonlocal total, entries_seen
        entries = []
        with os.scandir(fd) as iterator:
            for entry in iterator:
                entries_seen += 1
                require(entries_seen <= MAX_ENTRIES, "compiler directory inventory exceeds bound")
                entries.append(entry)
        for entry in sorted(entries, key=lambda item: item.name):
            info = entry.stat(follow_symlinks=False)
            child = (*parts, entry.name)
            if stat.S_ISDIR(info.st_mode):
                require((len(child) == 1 and UNIT.fullmatch(child[0])) or
                        (len(child) == 2 and UNIT.fullmatch(child[0]) and SESSION.fullmatch(child[1])), "unexpected compiler directory")
                nested = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    visit(nested, child)
                finally:
                    os.close(nested)
            else:
                name = "/".join(child)
                relative(name)
                require(stat.S_ISREG(info.st_mode), "nonregular compiler file rejected")
                require(not private or info.st_nlink == 1, "linked staged compiler file rejected")
                require(info.st_size <= MAX_FILE, "compiler file exceeds byte bound")
                require(not name.endswith(".lock") or info.st_size == 0, "nonempty compiler lock rejected")
                total += info.st_size
                require(total <= MAX_BYTES and len(result) < MAX_FILES, "compiler cache exceeds bounds")
                result.append({"path": name, "size": info.st_size})

    fd = open_tree(root)
    try:
        visit(fd, ())
    finally:
        os.close(fd)
    require(result, "empty compiler cache")
    return sorted(result, key=lambda item: item["path"])


def transfer(root, record, destination=None, private=False):
    """Hash/copy through no-follow descriptors and reject in-flight mutation."""
    parts = relative(record["path"]).parts
    parent = open_tree(root, parts[:-1])
    try:
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    digest = hashlib.sha256()
    with os.fdopen(fd, "rb") as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_size == record["size"], "compiler file changed before reading")
        require(not private or before.st_nlink == 1, "linked staged compiler file rejected")
        target = None
        try:
            if destination is not None:
                output = destination.joinpath(*parts)
                output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                target = open(output, "xb")
            count = 0
            while chunk := source.read(1024**2):
                count += len(chunk)
                require(count <= record["size"], "compiler file grew while reading")
                digest.update(chunk)
                if target is not None:
                    target.write(chunk)
            require(count == record["size"] and stable(before, os.fstat(source.fileno())), "compiler file changed while reading")
        finally:
            if target is not None:
                target.close()
    value = digest.hexdigest()
    require("sha256" not in record or value == record["sha256"], "compiler file hash mismatch")
    return {**record, "sha256": value}


def run(workspace, *args):
    result = subprocess.run(args, cwd=workspace, text=True, capture_output=True, timeout=60)
    require(result.returncode == 0, f"compiler metadata query failed: {args[0]}")
    require(len(result.stdout.encode()) <= MAX_MANIFEST, "compiler metadata output exceeds bound")
    return result.stdout.strip()


def compatibility(workspace, target, repository):
    require(target in TARGETS, "unsupported release target")
    require(re.fullmatch(r"[\w.-]+/[\w.-]+", repository or ""), "invalid repository")
    require(os.environ.get("CARGO_INCREMENTAL") == "1", "enable incremental after rust-cache before invoking this helper")
    require(os.environ.get("CARGO_PROFILE_RELEASE_CODEGEN_UNITS") == "16", "release codegen-units must remain 16")
    for key, default in [("OPT_LEVEL", "3"), ("DEBUG_ASSERTIONS", "false"), ("OVERFLOW_CHECKS", "false")]:
        require(os.environ.get("CARGO_PROFILE_RELEASE_" + key, default) == default, "release correctness/profile override differs")
    require(not os.environ.get("RUSTC_WRAPPER") and not os.environ.get("RUSTC_WORKSPACE_WRAPPER"), "compiler wrappers require a separate cache contract")
    release = tomllib.loads(regular(workspace / "Cargo.toml").decode()).get("profile", {}).get("release", {})
    require(release.get("opt-level", 3) == 3 and release.get("debug-assertions", False) is False and
            release.get("overflow-checks", False) is False, "release manifest profile differs")
    rustc = run(workspace, os.environ.get("RUSTC", "rustc"), "-Vv")
    require("release: 1.98.0\n" in rustc + "\n", "cache requires pinned Rust 1.98.0")
    cargo = run(workspace, "cargo", "-V")
    require(cargo.startswith("cargo 1.98.0 "), "cache requires pinned Cargo 1.98.0")
    metadata = json.loads(run(workspace, "cargo", "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1"))
    require(canonical(metadata["workspace_root"]) == workspace, "wrong Cargo workspace")
    require(canonical(metadata["target_directory"]) == workspace / "target", "only the owned default target directory is supported")
    manifests = {"Cargo.toml", "Cargo.lock"}
    for package in metadata["packages"]:
        path = canonical(package["manifest_path"])
        require(workspace in path.parents, "workspace manifest outside source root")
        manifests.add(path.relative_to(workspace).as_posix())
    require(len(manifests) <= 64, "too many workspace manifests")
    inputs = {name: hashlib.sha256(regular(workspace / name)).hexdigest() for name in sorted(manifests)}
    # Cargo reads configuration from the invocation directory's ancestors and
    # CARGO_HOME. Hash only these small regular files; never copy their content.
    configs = {}
    homes = [workspace, *workspace.parents]
    candidates = {root / ".cargo" / name for root in homes for name in ("config", "config.toml")}
    cargo_home = canonical(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
    candidates.update(cargo_home / name for name in ("config", "config.toml"))
    for path in sorted(candidates):
        canonical(path)
        configs[str(path)] = hashlib.sha256(regular(path, 1024**2)).hexdigest() if path.exists() else None
    require(len(configs) <= 128, "too many Cargo configuration inputs")
    prefixes = ("CARGO_", "RUST", "CC", "CFLAGS", "CXX", "CMAKE", "AR_")
    flags = {key: hashlib.sha256(value.encode()).hexdigest() for key, value in sorted(os.environ.items()) if key.startswith(prefixes)}
    require(len(flags) <= 128, "too many compiler environment inputs")
    return {"repository": repository, "role": "stable-release-build", "target": target, "profile": "release",
            "workspace": str(workspace), "system": platform.system(), "machine": platform.machine(),
            "rustc": rustc, "cargo": cargo, "inputs": inputs, "configs": configs, "flags": flags}


def provenance(workspace, repository):
    require(os.environ.get("GITHUB_EVENT_NAME") == "push" and os.environ.get("GITHUB_REF") in ("refs/heads/dev", "refs/heads/main"), "only trusted main/dev pushes can stage")
    require(os.environ.get("GITHUB_REPOSITORY") == repository, "foreign staging repository")
    sha = run(workspace, "git", "rev-parse", "HEAD")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) and os.environ.get("GITHUB_SHA") == sha, "staging checkout differs from push")
    event = json.loads(regular(Path(os.environ["GITHUB_EVENT_PATH"])))
    require(event.get("repository", {}).get("full_name") == repository and event.get("ref") == os.environ["GITHUB_REF"] and event.get("after") == sha, "push payload differs from staging identity")
    value = {"repository": repository, "event": "push", "ref": os.environ["GITHUB_REF"], "candidate_sha": sha,
             "run_id": os.environ.get("GITHUB_RUN_ID"), "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT")}
    validate_provenance(value, repository)
    return value


def validate_provenance(value, repository):
    require(isinstance(value, dict) and set(value) == {"repository", "event", "ref", "candidate_sha", "run_id", "run_attempt"}, "invalid compiler provenance fields")
    require(value["repository"] == repository and value["event"] == "push" and value["ref"] in ("refs/heads/dev", "refs/heads/main"), "compiler cache is not from a trusted repository push")
    require(isinstance(value["candidate_sha"], str) and re.fullmatch(r"[0-9a-f]{40}", value["candidate_sha"]), "invalid source provenance")
    for key in ("run_id", "run_attempt"):
        require(isinstance(value[key], str) and re.fullmatch(r"[1-9][0-9]*", value[key]), "invalid run provenance")


def strict_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate manifest field")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def validate_cache(cache, expected, hash_data=True):
    require(set(path.name for path in cache.iterdir()) == {"manifest.json", "data"}, "unexpected staged cache content")
    value = strict_json(regular(cache / "manifest.json"))
    require(isinstance(value, dict) and set(value) == {"schema", "compatibility", "provenance", "files", "total_bytes"} and value["schema"] == MODE, "invalid compiler cache manifest")
    actual = value["compatibility"]
    require(isinstance(actual, dict) and set(actual) == set(expected), "invalid compatibility fields")
    require(actual.get("repository") == expected["repository"] and actual.get("role") == "stable-release-build" and actual.get("profile") == "release" and actual.get("target") in TARGETS, "foreign compiler cache role")
    for key in ("workspace", "system", "machine", "rustc", "cargo"):
        require(isinstance(actual[key], str) and 0 < len(actual[key]) <= 8192 and "\0" not in actual[key], "invalid compatibility value")
    for key, bound in (("inputs", 64), ("configs", 128), ("flags", 128)):
        require(isinstance(actual[key], dict) and len(actual[key]) <= bound, "invalid compatibility digests")
        for name, digest in actual[key].items():
            require(isinstance(name, str) and 0 < len(name) <= 4096, "invalid compatibility input name")
            require((key == "configs" and digest is None) or (isinstance(digest, str) and HEX.fullmatch(digest)), "invalid compatibility digest")
    validate_provenance(value["provenance"], expected["repository"])
    files = value["files"]
    require(isinstance(files, list) and 0 < len(files) <= MAX_FILES, "invalid file inventory")
    for record in files:
        require(isinstance(record, dict) and set(record) == {"path", "size", "sha256"}, "invalid compiler file record")
        relative(record["path"])
        require(type(record["size"]) is int and 0 <= record["size"] <= MAX_FILE and isinstance(record["sha256"], str) and HEX.fullmatch(record["sha256"]), "invalid compiler file metadata")
    require(files == sorted(files, key=lambda item: item["path"]) and len({item["path"] for item in files}) == len(files), "duplicate or unsorted compiler files")
    total = sum(record["size"] for record in files)
    require(type(value["total_bytes"]) is int and total == value["total_bytes"] and total <= MAX_BYTES, "invalid compiler byte count")
    actual_files = inventory(cache / "data", private=True)
    require(actual_files == [{"path": item["path"], "size": item["size"]} for item in files], "staged files differ from manifest")
    if hash_data:
        for record in files:
            transfer(cache / "data", record, private=True)
    return value


def room(path, size):
    require(shutil.disk_usage(path).free >= size + RESERVE, "insufficient room for bounded compiler copy")


def restore(workspace, target, repository):
    expected = compatibility(workspace, target, repository)
    cache = canonical(workspace / ".nac-ci-incremental-cache" / target)
    destination = canonical(workspace / "target" / target / "release" / "incremental")
    if not cache.exists():
        return {"status": "cold", "reason": "absent-cache"}
    value = validate_cache(cache, expected, hash_data=False)
    if value["compatibility"] != expected:
        for record in value["files"]:
            transfer(cache / "data", record, private=True)
        return {"status": "cold", "reason": "configuration-mismatch"}
    require(not destination.exists(), "refuse to replace existing compiler output")
    destination.parent.mkdir(parents=True, exist_ok=True)
    room(destination.parent, value["total_bytes"])
    temporary = Path(tempfile.mkdtemp(prefix=".incremental-restore-", dir=destination.parent))
    try:
        for record in value["files"]:
            transfer(cache / "data", record, temporary, private=True)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {"status": "restored", "files": len(value["files"]), "bytes": value["total_bytes"], "seed_sha": value["provenance"]["candidate_sha"]}


def stage(workspace, target, repository):
    origin = provenance(workspace, repository)  # Check writer authority before creating anything.
    expected = compatibility(workspace, target, repository)
    source = canonical(workspace / "target" / target / "release" / "incremental")
    records = inventory(source)
    total = sum(item["size"] for item in records)
    cache = canonical(workspace / ".nac-ci-incremental-cache" / target)
    if cache.exists():
        validate_cache(cache, expected)  # Never overwrite an unowned/malformed directory.
    cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    room(cache.parent, total)
    temporary = Path(tempfile.mkdtemp(prefix=".incremental-stage-", dir=cache.parent))
    backup = temporary / "previous"
    try:
        data = temporary / "data"
        data.mkdir(mode=0o700)
        files = [transfer(source, record, data) for record in records]
        value = {"schema": MODE, "compatibility": expected, "provenance": origin, "files": files, "total_bytes": total}
        encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        require(len(encoded) <= MAX_MANIFEST, "compiler manifest exceeds bound")
        (temporary / "manifest.json").write_bytes(encoded)
        if cache.exists():
            # The old tree was validated. Move it aside without deleting any
            # compiler target; replacement and cleanup concern only this cache.
            os.replace(cache, backup)
        try:
            os.replace(temporary, cache)
        except BaseException:
            if backup.exists():
                os.replace(backup, cache)
            raise
        # backup moved with temporary into cache, so remove its validated tree.
        if (cache / "previous").exists():
            shutil.rmtree(cache / "previous")
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return {"status": "staged", "files": len(files), "bytes": total, "seed_sha": origin["candidate_sha"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("restore", "stage"))
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--target", choices=sorted(TARGETS), required=True)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"))
    args = parser.parse_args()
    workspace = canonical(args.workspace)
    require(workspace.is_dir(), "workspace missing")
    print(json.dumps(globals()[args.command](workspace, args.target, args.repository), sort_keys=True))


if __name__ == "__main__":
    main()
