"""Synthetic Rust distribution evidence for scanner contract tests (no network)."""
import json
from image_inventory import write_json
from image_rust import BINARIES, COMPONENTS, TARGET, digest, manifest_identities


def rust_fixture(output):
    version = "1.98.0"
    text = 'manifest-version = "2"\ndate = "2026-08-20"\n'
    versions = {"rust": version, "rustc": version, "rust-std": version,
                "cargo": "0.99.0", "rustfmt-preview": "1.9.0", "clippy-preview": "0.1.98"}
    for name, v in versions.items():
        commit = ' (abcdef123 2026-08-18)' if name in {"rust", "rustc", "rust-std", "cargo"} else ''
        text += f'\n[pkg.{name}]\nversion = "{v}{commit}"\n[pkg.{name}.target.{TARGET}]\navailable = true\n'
        text += f'xz_url = "https://static.rust-lang.org/dist/2026-08-20/{name}-{version}-{TARGET}.tar.xz"\nxz_hash = "' + 'a' * 64 + '"\n'
    data = text.encode()
    pins = {"RUST_VERSION": version, "RUSTUP_VERSION": "1.29.0", "RUSTUP_SHA256": "b" * 64,
            "manifest_sha256": digest(data)}
    _, identities = manifest_identities(data, version, digest(data))
    payload = {"bin/" + name: {"sha256": "c" * 64} for name in BINARIES}
    payload[f"lib/rustlib/{TARGET}/lib/libstd.rlib"] = {"sha256": "d" * 64}
    (output / "rust-distribution.toml").write_bytes(data)
    write_json(output / "rust-payload.json", payload)
    write_json(output / "rust-distribution.json", {"url": "fixture", "target": TARGET, "identities": identities,
               "sha256": digest(data), "payload_sha256": digest((output / "rust-payload.json").read_bytes())})
    toolchain = version + "-" + TARGET
    versions = {name: f"{name} {v} (abcdef123 2026-08-18)" for name, v in
                (("rustc", version), ("cargo", version), ("rustfmt", "1.9.0"), ("clippy", "0.1.98"), ("rustup", "1.29.0"))}
    versions["clippy-driver"] = versions.pop("clippy")
    for name in ("rustc", "cargo"):
        versions[name] += f"\nrelease: {version}\nhost: {TARGET}\ncommit-hash: abcdef123456789\ncommit-date: 2026-08-18"
    raw = {"active": toolchain + " (default)", "toolchains": [toolchain], "targets": TARGET,
           "which": {n: f"/usr/local/rustup/toolchains/{toolchain}/bin/{n}" for n in BINARIES},
           "proxies": {n: {"path": "/usr/local/cargo/bin/" + n,
                           "resolved": "/usr/local/cargo/bin/" + n, "sha256": pins["RUSTUP_SHA256"]}
                       for n in (*BINARIES, "rustup")}, "versions": versions,
           "components": "\n".join(n + "-" + TARGET for n in sorted(COMPONENTS)), "payload": payload}
    return pins, raw


def add_rust_bundle(root):
    pins, raw = rust_fixture(root)
    for name, field, value in (("runtime.json", "rust", raw), ("identity.json", "rust_pins", pins)):
        path = root / name
        obj = json.loads(path.read_text())
        obj[field] = value
        write_json(path, obj)
