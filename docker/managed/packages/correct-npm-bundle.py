#!/usr/bin/env python3
"""Apply two checksum-pinned patch releases to the otherwise pinned npm11 graph."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unpack(data, root):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        seen = set()
        for member in archive:
            path = PurePosixPath(member.name)
            if (not path.parts or path.parts[0] != "package" or path.is_absolute()
                    or ".." in path.parts or str(path) in seen
                    or not (member.isdir() or member.isfile())):
                raise ValueError("noncanonical npm correction archive")
            seen.add(str(path))
            target = root.joinpath(*path.parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
                target.chmod(member.mode & 0o755)
    # These are public package assets. copytree preserves the private temporary
    # root's mode, so normalize traversal/readability before copying as root.
    for path in [root, *root.rglob("*")]:
        path.chmod(0o755 if path.is_dir() else (path.stat().st_mode & 0o755) | 0o444)


def probe(recipe, root, mode, vulnerable=False):
    result = subprocess.run(["node", str(recipe / "npm-bundle-probe.cjs"),
                             str(root / "node_modules/undici"), mode],
                            capture_output=True, text=True, timeout=20)
    if vulnerable:
        if result.returncode == 0 or "UND_ERR_RES_CONTENT_LENGTH_MISMATCH" not in result.stderr:
            raise ValueError("vulnerable Undici negative control did not reproduce")
    elif result.returncode:
        raise ValueError(f"corrected npm protocol regression failed: {result.stderr}")


def correct(recipe, root, downloads=None):
    lock = json.loads((recipe / "npm-bundle.lock.json").read_text())
    parent = json.loads((root / "package.json").read_text())
    if (parent["name"], parent["version"], parent["license"]) != ("npm", "11.21.1", "Artistic-2.0"):
        raise ValueError("npm parent differs from reviewed graph")
    # This parent is installed by the Dockerfile's separately verified archive.
    if lock["parent"]["version"] != parent["version"]:
        raise ValueError("npm correction lock/parent mismatch")
    probe(recipe, root, "early-close", vulnerable=True)
    installed = {}
    for name, spec in lock["corrections"].items():
        destination = root / "node_modules" / name
        current = json.loads((destination / "package.json").read_text())
        consumer = json.loads((root / "node_modules" / spec["consumer"] / "package.json").read_text())
        if current["version"] != spec["from"] or consumer["dependencies"][name] != spec["requirement"]:
            raise ValueError(f"npm bundle predecessor/consumer differs: {name}")
        if downloads:
            data = (downloads / f"{name}-{spec['version']}.tgz").read_bytes()
        else:
            with urllib.request.urlopen(spec["url"], timeout=120) as response:
                data = response.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024 or digest(data) != spec["sha256"]:
            raise ValueError(f"npm bundle source checksum differs: {name}")
        with tempfile.TemporaryDirectory(prefix="nac-npm-") as directory:
            staged = Path(directory)
            unpack(data, staged)
            metadata = json.loads((staged / "package.json").read_text())
            if ((metadata["name"], metadata["version"], metadata["license"]) !=
                    (name, spec["version"], spec["license"]) or metadata.get("dependencies")):
                raise ValueError(f"npm correction introduces an unreviewed graph: {name}")
            if not (staged / "LICENSE").is_file():
                raise ValueError(f"npm correction missing license: {name}")
            shutil.rmtree(destination)
            shutil.copytree(staged, destination)
        installed[name] = {str(path.relative_to(root)): digest(path.read_bytes())
                           for path in sorted(destination.rglob("*")) if path.is_file()}
    probe(recipe, root, "early-close")
    probe(recipe, root, "compatible")
    receipt = {"schema_version": 1, "supplier": "NAC downstream npm bundle correction",
               "lock": lock, "parent_package_json_sha256": digest((root / "package.json").read_bytes()),
               "installed_payload": installed,
               "qualification": "local protocol controls passed; no advisory waiver"}
    (recipe / "npm-bundle-provenance.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    correct(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]) if len(sys.argv) > 3 else None)
