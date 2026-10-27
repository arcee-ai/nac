"""Exact installed Rust distribution identity; no advisory or policy exemptions."""
import hashlib
import io
import json
from pathlib import PurePosixPath
import re
import tarfile
import tomllib

from image_inventory import require, write_json

TARGET = "x86_64-unknown-linux-gnu"
COMPONENTS = {"rustc", "cargo", "rust-std", "rustfmt-preview", "clippy-preview"}
# Official immutable release manifest, reviewed independently of image version output.
MANIFEST_PINS = {"1.98.0": "3f7d139b73bbbd0004ef6e58b430831c68cdad2b1f64ee2eb35d54c09199489a"}
BINARIES = {"rustc": "rustc", "cargo": "cargo", "rustfmt": "rustfmt-preview",
            "cargo-fmt": "rustfmt-preview", "clippy-driver": "clippy-preview",
            "cargo-clippy": "clippy-preview"}
RUST_FILES = {"rust-distribution.toml", "rust-distribution.json", "rust-payload.json"}

RUST_PROBE = r'''
import hashlib, os, stat
rustup = "/usr/local/cargo/bin/rustup"
def rust_command(args):
    return subprocess.check_output(args, text=True, timeout=30).strip()
def rust_signature(p):
    if p.is_symlink():
        return {"symlink": os.readlink(p)}
    with os.fdopen(os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
            raise ValueError("nonregular Rust payload")
        return {"sha256": hashlib.file_digest(f, "sha256").hexdigest()}
active = rust_command([rustup, "show", "active-toolchain"])
toolchains = sorted(p.name for p in Path("/usr/local/rustup/toolchains").iterdir())
if len(toolchains) != 1:
    raise ValueError("unexpected Rust toolchains")
toolchain = Path("/usr/local/rustup/toolchains") / toolchains[0]
which = {n: rust_command([rustup, "which", n]) for n in
         ("rustc", "cargo", "rustfmt", "cargo-fmt", "clippy-driver", "cargo-clippy")}
proxies = {n: {"path": "/usr/local/cargo/bin/" + n,
               "resolved": str(Path("/usr/local/cargo/bin", n).resolve()),
               **rust_signature(Path("/usr/local/cargo/bin", n).resolve())}
           for n in (*which, "rustup")}
evidence["rust"] = {
    "active": active, "toolchains": toolchains, "which": which, "proxies": proxies,
    "versions": {n: rust_command(["/usr/local/cargo/bin/" + n, *flags]) for n, flags in
                 {"rustc": ["-vV"], "cargo": ["-Vv"], "rustup": ["--version"],
                  "rustfmt": ["--version"], "clippy-driver": ["--version"]}.items()},
    "components": rust_command([rustup, "component", "list", "--installed"]),
    "targets": rust_command([rustup, "target", "list", "--installed"]),
    "payload": {str(p.relative_to(toolchain)): rust_signature(p)
                for p in sorted(toolchain.rglob("*")) if not p.is_dir() or p.is_symlink()}}
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_rust_pins(dockerfile):
    pins = {}
    for name, pattern in {"RUST_VERSION": r"\d+\.\d+\.\d+", "RUSTUP_VERSION": r"\d+\.\d+\.\d+",
                          "RUSTUP_SHA256": r"[0-9a-f]{64}"}.items():
        values = re.findall(rf"^ARG {name}=({pattern})$", dockerfile, re.M)
        require(len(values) == 1, f"missing/ambiguous Rust source pin: {name}")
        pins[name] = values[0]
    require(pins["RUST_VERSION"] in MANIFEST_PINS, "Rust release lacks reviewed distribution manifest pin")
    pins["manifest_sha256"] = MANIFEST_PINS[pins["RUST_VERSION"]]
    return pins


def manifest_identities(data, version, expected_hash):
    require(digest(data) == expected_hash, "Rust distribution manifest checksum mismatch")
    manifest = tomllib.loads(data.decode())
    require(manifest.get("manifest-version") == "2", "unsupported Rust manifest schema")
    packages = manifest.get("pkg", {})
    versions = {}
    for name in sorted(COMPONENTS | {"rust"}):
        package = packages.get(name, {})
        value = package.get("version", "")
        match = re.fullmatch(r"(\d+\.\d+\.\d+)(?: \(([0-9a-f]{9,40}) (\d{4}-\d{2}-\d{2})\))?", value)
        require(match is not None, f"missing/malformed Rust manifest component: {name}")
        versions[name] = {"version": match[1], "commit": match[2], "date": match[3]}
        target = package.get("target", {}).get(TARGET, {})
        require(target.get("available") is True, f"missing Rust manifest target: {name}")
        if name != "rust":
            require(re.fullmatch(r"[0-9a-f]{64}", target.get("xz_hash", "")), "missing Rust archive hash")
            require(target.get("xz_url", "").startswith(
                f"https://static.rust-lang.org/dist/{manifest['date']}/"), "nonofficial Rust archive")
    require(all(versions[k]["version"] == version for k in ("rust", "rustc", "rust-std")),
            "Rust/std distribution version mismatch")
    cargo = packages["cargo"]["target"][TARGET]["xz_url"]
    require(cargo.endswith(f"/cargo-{version}-{TARGET}.tar.xz"), "Cargo distribution identity mismatch")
    require(versions["cargo"]["version"].startswith("0."), "unsupported Cargo source identity")
    return manifest, versions


def archive_payload(data, component):
    """Read archive files without extracting or executing installer content."""
    payload = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:xz") as archive:
        members = archive.getmembers()
        roots = {m.name.split("/")[0] for m in members}
        require(len(roots) == 1, "ambiguous Rust archive root")
        root = roots.pop()
        installed = component + ("-" + TARGET if component == "rust-std" else "")
        prefix = f"{root}/{installed}/"
        entries = archive.extractfile(f"{prefix}manifest.in").read().decode().splitlines()
        files, directories = set(), set()
        for entry in entries:
            kind, sep, path = entry.partition(":")
            require(sep and kind in {"file", "dir"} and path and
                    str(PurePosixPath(path)) == path and not path.startswith("/") and
                    ".." not in PurePosixPath(path).parts, "malformed Rust archive manifest")
            (files if kind == "file" else directories).add(path)
        for member in members:
            if not member.name.startswith(prefix):
                continue
            path = member.name[len(prefix):]
            if member.isdir() or path == "manifest.in":
                continue
            require(path in files or any(path.startswith(d + "/") for d in directories),
                    "unlisted Rust distribution payload")
            require(path and not path.startswith("/") and ".." not in PurePosixPath(path).parts,
                    "unsafe Rust archive path")
            require(path not in payload, "duplicate Rust archive payload")
            if member.issym():
                payload[path] = {"symlink": member.linkname}
            else:
                require(member.isfile(), "unsupported Rust archive payload type")
                payload[path] = {"sha256": digest(archive.extractfile(member).read())}
        require(files.issubset(payload) and payload, "incomplete Rust archive payload")
    return payload


def collect_distribution(pins, output, download):
    version = pins["RUST_VERSION"]
    url = f"https://static.rust-lang.org/dist/channel-rust-{version}.toml"
    raw = download(url)
    (output / "rust-distribution.toml").write_bytes(raw)
    manifest, versions = manifest_identities(raw, version, pins["manifest_sha256"])
    payload, archives = {}, {}
    for component in sorted(COMPONENTS):
        spec = manifest["pkg"][component]["target"][TARGET]
        data = download(spec["xz_url"])
        require(digest(data) == spec["xz_hash"], f"Rust component archive checksum mismatch: {component}")
        files = archive_payload(data, component)
        for path, signature in files.items():
            require(path not in payload or payload[path] == signature, "conflicting Rust archive payload")
            payload[path] = signature
        archives[component] = {"url": spec["xz_url"], "sha256": spec["xz_hash"], "files": len(files)}
    write_json(output / "rust-payload.json", payload)
    write_json(output / "rust-distribution.json", {"url": url, "sha256": digest(raw),
               "target": TARGET, "identities": versions, "archives": archives,
               "payload_sha256": digest((output / "rust-payload.json").read_bytes())})


def rust_inventory(raw, pins, output):
    require(isinstance(pins, dict) and set(pins) == {
        "RUST_VERSION", "RUSTUP_VERSION", "RUSTUP_SHA256", "manifest_sha256"}, "missing Rust source pins; reinventory")
    require(isinstance(raw, dict), "missing actual Rust inventory; reinventory")
    data = (output / "rust-distribution.toml").read_bytes()
    manifest, identities = manifest_identities(data, pins["RUST_VERSION"], pins["manifest_sha256"])
    distribution = json.loads((output / "rust-distribution.json").read_text())
    require(distribution["identities"] == identities and distribution["sha256"] == digest(data) and
            distribution["target"] == TARGET, "retained Rust distribution identity mismatch")
    payload_bytes = (output / "rust-payload.json").read_bytes()
    require(digest(payload_bytes) == distribution["payload_sha256"], "retained Rust payload hash mismatch")
    expected = json.loads(payload_bytes)
    require(expected and isinstance(raw.get("payload"), dict), "missing Rust payload inventory")
    toolchain = pins["RUST_VERSION"] + "-" + TARGET
    require(raw.get("toolchains") == [toolchain] and raw.get("active") == toolchain + " (default)",
            "unexpected active Rust toolchain")
    require(raw.get("targets") == TARGET, "wrong/unexpected Rust target")
    components = {n + "-" + TARGET for n in COMPONENTS}
    require(set(raw.get("components", "").splitlines()) == components, "missing/unexpected installed Rust component")
    proxies, which, versions = raw.get("proxies", {}), raw.get("which", {}), raw.get("versions", {})
    require(set(proxies) == {*BINARIES, "rustup"} and set(which) == set(BINARIES), "missing Rust proxy evidence")
    for name, proxy in proxies.items():
        require(proxy == {"path": "/usr/local/cargo/bin/" + name,
                           "resolved": "/usr/local/cargo/bin/" + name,
                           "sha256": pins["RUSTUP_SHA256"]}, "Rust proxy/rustup hash or path mismatch")
    root = "/usr/local/rustup/toolchains/" + toolchain
    for name in BINARIES:
        require(which[name] == root + "/bin/" + name, "Rust proxy resolves to unexpected binary")
        require("bin/" + name in expected, "missing actual Rust distribution binary")
    for path, signature in expected.items():
        require(raw["payload"].get(path) == signature, f"installed Rust distribution bytes differ: {path}")
    # Rustup owns installer bookkeeping; every additional executable/library is rejected.
    extras = set(raw["payload"]) - set(expected)
    bookkeeping = {"lib/rustlib/components", "lib/rustlib/rust-installer-version",
                   "lib/rustlib/multirust-channel-manifest.toml", "lib/rustlib/multirust-config.toml",
                   "lib/rustlib/install.log", "lib/rustlib/uninstall.sh"}
    bookkeeping |= {"lib/rustlib/manifest-" + n + "-" + TARGET for n in COMPONENTS}
    require(extras.issubset(bookkeeping), f"unexpected Rust payload: {sorted(extras)[:10]}")
    for name, key in (("rustc", "rustc"), ("cargo", "cargo"), ("rustfmt", "rustfmt-preview"),
                      ("clippy-driver", "clippy-preview")):
        version = pins["RUST_VERSION"] if name == "cargo" else identities[key]["version"]
        prefix = "clippy" if name == "clippy-driver" else name
        require(re.match(rf"^{prefix} {re.escape(version)}(?:-stable)?(?: |$)", versions.get(name, "")),
                f"Rust binary version differs from manifest: {name}")
    require(re.fullmatch(r"rustup " + re.escape(pins["RUSTUP_VERSION"]) + r" \([0-9a-f]+ \d{4}-\d{2}-\d{2}\)",
                         versions.get("rustup", "")), "Rustup version differs from source pin")
    for name in ("rustc", "cargo"):
        fields = dict(line.split(": ", 1) for line in versions[name].splitlines()[1:] if ": " in line)
        require(fields.get("host") == TARGET and fields.get("release") == pins["RUST_VERSION"],
                f"wrong Rust binary target/release: {name}")
        require(fields.get("commit-hash", "").startswith(identities[name]["commit"]) and
                fields.get("commit-date") == identities[name]["date"], "Rust binary commit differs from manifest")
    return {"target": TARGET, "distribution": pins["RUST_VERSION"],
            "components": identities, "rustup": pins["RUSTUP_VERSION"],
            "manifest_sha256": digest(data), "payload_sha256": digest(payload_bytes),
            "coverage": "official public rust-lang component repository security advisories"}
