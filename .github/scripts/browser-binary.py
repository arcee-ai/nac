#!/usr/bin/env python3
"""Package and admit exact-run browser executables; never carry quality verdicts."""

import argparse
import contextlib
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile
import zlib


ARCHIVE = "browser-binary.tar.gz"
BINARY = "nac-web"
MAX_BINARY = 512 * 1024 * 1024
MAX_ARCHIVE = MAX_BINARY + 1024 * 1024
MAX_JSON = 4096
CHUNK = 1024 * 1024
IDENTITY = {
    "schema", "source_revision", "repository", "run_id", "run_attempt", "target",
    "rustc", "runner_image", "profile", "dev_debug", "build_track", "build_id",
}
RECEIPT = IDENTITY | {
    "archive_sha256", "archive_bytes", "manifest_sha256", "manifest_bytes",
    "binary_sha256", "binary_bytes",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, maximum=None):
    return type(value) is int and value > 0 and (maximum is None or value <= maximum)


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def text(value):
    return isinstance(value, str) and 0 < len(value) <= 256 and all(32 <= ord(c) < 127 for c in value)


def identity(value):
    require(isinstance(value, dict) and IDENTITY <= value.keys(), "missing binary identity")
    require(type(value["schema"]) is int and value["schema"] == 1, "invalid schema")
    source = value["source_revision"]
    require(isinstance(source, str) and re.fullmatch(r"[0-9a-f]{40}", source), "invalid source revision")
    repo = value["repository"]
    require(text(repo) and re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)
            and not any(part in {".", ".."} for part in repo.split("/")), "invalid repository")
    require(isinstance(value["run_id"], str) and re.fullmatch(r"[1-9][0-9]{0,29}", value["run_id"]), "invalid run ID")
    require(integer(value["run_attempt"]), "invalid run attempt")
    require(text(value["target"]) and re.fullmatch(r"[A-Za-z0-9_.-]+", value["target"]), "invalid target")
    require(text(value["rustc"]) and value["rustc"].startswith("rustc "), "invalid compiler identity")
    require(text(value["runner_image"])
            and re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+", value["runner_image"]),
            "invalid runner image")
    require(value["profile"] == "dev" and type(value["dev_debug"]) is int and value["dev_debug"] == 0,
            "invalid browser profile")
    require(value["build_track"] == "dev" and value["build_id"] == f"dev-{source}", "invalid build identity")


def expected(args):
    value = {
        "schema": 1, "source_revision": args.source, "repository": args.repository,
        "run_id": args.run_id, "run_attempt": args.attempt, "target": args.target,
        "rustc": args.rustc, "runner_image": args.runner_image,
        "profile": "dev", "dev_debug": 0, "build_track": "dev", "build_id": f"dev-{args.source}",
    }
    identity(value)
    return value


def pairs(items):
    value = {}
    for key, item in items:
        require(key not in value, "duplicate JSON field")
        value[key] = item
    return value


def decode(data):
    require(len(data) <= MAX_JSON, "oversized JSON receipt or manifest")
    value = json.loads(data, object_pairs_hook=pairs,
                       parse_constant=lambda _: require(False, "nonfinite JSON value"))
    require(isinstance(value, dict), "JSON object required")
    return value


@contextlib.contextmanager
def regular(path, maximum):
    # Nonblocking prevents a FIFO from hanging before its type can be rejected.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum, "invalid regular file or size")
        yield handle, info


def digest(handle, size):
    result = hashlib.sha256()
    remaining = size
    for chunk in iter(lambda: handle.read(min(CHUNK, remaining + 1)), b""):
        remaining -= len(chunk)
        require(remaining >= 0, "file grew while hashing")
        result.update(chunk)
    require(remaining == 0, "file shrank while hashing")
    return result.hexdigest()


class DigestReader:
    def __init__(self, handle):
        self.handle = handle
        self.hash = hashlib.sha256()

    def read(self, size):
        data = self.handle.read(size)
        self.hash.update(data)
        return data


def new_directory(path):
    path = Path(os.path.abspath(path))
    # An existing or symlinked leaf is never overwritten or cleaned up.
    require(not path.parent.is_symlink(), "symlinked output parent")
    path.mkdir(mode=0o700)
    return path


def pack(binary, output, value):
    identity(value)
    with regular(binary, MAX_BINARY) as (handle, info):
        require(info.st_mode & 0o111, "producer binary must be executable")
        binary_hash = digest(handle, info.st_size)
        manifest = {**value, "binary": {"name": BINARY, "bytes": info.st_size, "sha256": binary_hash}}
        data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        require(len(data) <= MAX_JSON, "oversized manifest")
        root = new_directory(output)
        try:
            archive = root / ARCHIVE
            with archive.open("xb") as destination:
                with gzip.GzipFile(fileobj=destination, mode="wb", compresslevel=6, mtime=0) as compressed:
                    with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.USTAR_FORMAT) as tar:
                        entry = tarfile.TarInfo("manifest.json")
                        entry.mode, entry.size = 0o644, len(data)
                        tar.addfile(entry, io.BytesIO(data))
                        entry = tarfile.TarInfo(BINARY)
                        entry.mode, entry.size = 0o755, info.st_size
                        handle.seek(0)
                        copied = DigestReader(handle)
                        tar.addfile(entry, copied)
                        require(copied.hash.hexdigest() == binary_hash and not handle.read(1),
                                "binary changed during packaging")
            with regular(archive, MAX_ARCHIVE) as (packed, packed_info):
                receipt = {
                    **value, "archive_sha256": digest(packed, packed_info.st_size), "archive_bytes": packed_info.st_size,
                    "manifest_sha256": hashlib.sha256(data).hexdigest(), "manifest_bytes": len(data),
                    "binary_sha256": binary_hash, "binary_bytes": info.st_size,
                }
            require(len(json.dumps(receipt, separators=(",", ":")).encode()) <= MAX_JSON,
                    "oversized producer receipt")
            return {"receipt": receipt, "archive": str(archive), "binary_sha256": binary_hash}
        except BaseException:
            shutil.rmtree(root)
            raise


def receipt_identity(receipt, value):
    require(isinstance(receipt, dict) and set(receipt) == RECEIPT, "malformed producer receipt")
    identity(receipt)
    for key in IDENTITY - {"run_attempt", "runner_image"}:
        require(receipt[key] == value[key], f"wrong producer {key}")
    require(receipt["run_attempt"] <= value["run_attempt"], "future producer attempt")
    # A runner image can roll forward between partial retries. The older
    # artifact is still validated completely, then discarded for a source build.
    require(receipt["run_attempt"] < value["run_attempt"]
            or receipt["runner_image"] == value["runner_image"], "wrong producer runner_image")
    for name in ("archive", "manifest", "binary"):
        require(sha(receipt[f"{name}_sha256"]), f"invalid {name} digest")
    require(integer(receipt["archive_bytes"], MAX_ARCHIVE), "invalid archive size")
    require(integer(receipt["manifest_bytes"], MAX_JSON), "invalid manifest size")
    require(integer(receipt["binary_bytes"], MAX_BINARY), "invalid binary size")


class BoundedReader:
    def __init__(self, handle, maximum):
        self.handle, self.remaining = handle, maximum

    def read(self, size):
        data = self.handle.read(min(size, self.remaining + 1))
        self.remaining -= len(data)
        require(self.remaining >= 0, "oversized decompressed archive")
        return data


def exact(handle, size):
    data = handle.read(size)
    require(len(data) == size, "truncated archive")
    return data


def member(handle, name, size, mode):
    entry = tarfile.TarInfo.frombuf(exact(handle, 512), "utf-8", "strict")
    require(entry.name == name and entry.type == tarfile.REGTYPE and not entry.linkname,
            "unexpected, duplicate or unsafe archive member")
    require(entry.size == size and entry.mode == mode, "wrong archive member size or mode")


def padding(handle, size):
    require(not any(exact(handle, (-size) % 512)), "nonzero archive padding")


def extract(handle, root, receipt):
    # Parse just the fixed USTAR format emitted above. No filesystem extraction
    # API, PAX extension, link, directory or caller-controlled member name runs.
    raw = BoundedReader(handle, receipt["archive_bytes"])
    with gzip.GzipFile(fileobj=raw, mode="rb") as compressed:
        stream = BoundedReader(compressed, receipt["binary_bytes"] + receipt["manifest_bytes"] + 32768)
        member(stream, "manifest.json", receipt["manifest_bytes"], 0o644)
        data = exact(stream, receipt["manifest_bytes"])
        require(hashlib.sha256(data).hexdigest() == receipt["manifest_sha256"], "corrupt manifest")
        manifest = decode(data)
        require(set(manifest) == IDENTITY | {"binary"}, "malformed manifest")
        identity(manifest)
        require(all(manifest[key] == receipt[key] for key in IDENTITY), "foreign manifest identity")
        require(manifest["binary"] == {"name": BINARY, "bytes": receipt["binary_bytes"],
                                       "sha256": receipt["binary_sha256"]}, "wrong manifest binary")
        require(type(manifest["binary"]["bytes"]) is int, "invalid manifest binary size")
        padding(stream, receipt["manifest_bytes"])
        member(stream, BINARY, receipt["binary_bytes"], 0o755)
        result = hashlib.sha256()
        remaining = receipt["binary_bytes"]
        with (root / BINARY).open("xb") as output:
            while remaining:
                chunk = exact(stream, min(remaining, CHUNK))
                output.write(chunk)
                result.update(chunk)
                remaining -= len(chunk)
        require(result.hexdigest() == receipt["binary_sha256"], "corrupt binary")
        padding(stream, receipt["binary_bytes"])
        require(not any(exact(stream, 1024)), "unexpected trailing archive member")
        # Drain and validate gzip CRC/truncation and the bounded zero tar trailer.
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            require(not any(chunk), "unexpected archive trailer")


def consume(archive, output, receipt, value):
    identity(value)
    receipt_identity(receipt, value)
    with regular(archive, MAX_ARCHIVE) as (handle, info):
        require(info.st_size == receipt["archive_bytes"], "wrong archive byte count")
        require(digest(handle, info.st_size) == receipt["archive_sha256"], "corrupt archive")
        handle.seek(0)
        root = new_directory(output)
        try:
            extract(handle, root, receipt)
            if receipt["run_attempt"] < value["run_attempt"]:
                shutil.rmtree(root)
                return {"mode": "source", "binary": "", "binary_sha256": "",
                        "producer_attempt": receipt["run_attempt"]}
            binary = root / BINARY
            binary.chmod(0o755)
            return {"mode": "artifact", "binary": str(binary),
                    "binary_sha256": receipt["binary_sha256"], "producer_attempt": receipt["run_attempt"]}
        except BaseException:
            shutil.rmtree(root)
            raise


def verify_proof(binary, proof_dir, source):
    require(isinstance(source, str) and re.fullmatch(r"[0-9a-f]{40}", source), "invalid proof source")
    binary = Path(os.path.abspath(binary))
    with regular(binary, MAX_BINARY) as (handle, info):
        require(info.st_mode & 0o111, "proof binary must be executable")
        binary_hash = digest(handle, info.st_size)
    root = Path(proof_dir)
    require(not root.is_symlink(), "symlinked proof directory")
    for case in ("g1", "g2"):
        with regular(root / f"all471-{case}-proof.json", 131072) as (handle, _):
            # Existing browser-proof.py owns full receipt admission. This extra
            # check binds its staged actual runtime identities to this executable.
            data = json.loads(handle.read(131073), object_pairs_hook=pairs)
        require(isinstance(data, dict), "malformed goal proof")
        for name in (("identity", "restarted") if case == "g1" else ("identity",)):
            observed = data.get(name)
            require(isinstance(observed, dict) and observed.get("source") == source
                    and observed.get("binary_sha256") == binary_hash
                    and observed.get("binary") == str(binary), "goal proof uses a different binary")
    return {"binary_sha256": binary_hash, "source_revision": source}


def emit(result, output):
    encoded = json.dumps(result, sort_keys=True, separators=(",", ":"))
    if output:
        lines = []
        for key, value in result.items():
            value = json.dumps(value, sort_keys=True, separators=(",", ":")) if isinstance(value, dict) else str(value)
            require("\n" not in value and "\r" not in value, "invalid GitHub output value")
            lines.append(f"{key}={value}\n")
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "invalid GitHub output file")
            handle.write("".join(lines))
    print(encoded)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    producer = commands.add_parser("pack")
    producer.add_argument("--binary", required=True)
    producer.add_argument("--output-dir", required=True)
    consumer = commands.add_parser("consume")
    consumer.add_argument("--archive", required=True)
    consumer.add_argument("--output-dir", required=True)
    consumer.add_argument("--receipt-env", default="BROWSER_BINARY_RECEIPT")
    for command in (producer, consumer):
        for flag in ("source", "repository", "run-id", "target", "rustc", "runner-image"):
            command.add_argument(f"--{flag}", required=True)
        command.add_argument("--attempt", required=True, type=int)
    proof = commands.add_parser("verify-proof")
    for flag in ("binary", "proof-dir", "source"):
        proof.add_argument(f"--{flag}", required=True)
    for command in (producer, consumer, proof):
        command.add_argument("--github-output")
    args = parser.parse_args()
    try:
        if args.command == "pack":
            result = pack(args.binary, args.output_dir, expected(args))
        elif args.command == "consume":
            result = consume(args.archive, args.output_dir,
                             decode(os.environ.get(args.receipt_env, "").encode()), expected(args))
        else:
            result = verify_proof(args.binary, args.proof_dir, args.source)
        emit(result, args.github_output)
    except (OSError, ValueError, tarfile.TarError, EOFError, zlib.error) as error:
        print(f"browser-binary: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
