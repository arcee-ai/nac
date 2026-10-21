#!/usr/bin/env python3
"""Gate/rescan a loaded immutable managed image. Never builds or publishes images."""
import argparse
import datetime as dt
import io
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

from image_inventory import (database, grype_findings, inventory,
                             osv_findings, require, sha256, write_json, write_report)

ROOT = Path(__file__).resolve().parents[2]
PINS = Path(__file__).with_name("image-tools.json")
PROBE = r"""
import json, subprocess
commands = {"node": ["/usr/local/bin/node", "--version"],
            "go": ["/usr/local/go/bin/go", "version"],
            "uv": ["/usr/local/bin/uv", "--version"],
            "nac": ["/usr/local/bin/nac-web", "--version"],
            "dpkg": ["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\n"]}
print(json.dumps({k: subprocess.check_output(v, text=True).strip() for k,v in commands.items()}))
"""


def command(args, *, env=None, output=None, timeout=600):
    result = subprocess.run([str(x) for x in args], env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if output:
        output.write_text(result.stdout)
        output.with_suffix(output.suffix + ".stderr").write_text(result.stderr)
    require(result.returncode == 0,
            f"command failed ({result.returncode}): {args[0]}: {result.stderr[-2000:]}")
    return result.stdout


def download(url, limit=150 * 1024 * 1024, data=None):
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        result = response.read(limit + 1)
    require(len(result) <= limit, "download exceeded size limit")
    return result


def install_tools(cache):
    pins = json.loads(PINS.read_text())
    system = platform.system().lower()
    machine = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64"}.get(platform.machine())
    host = f"{system}_{machine}"
    paths, evidence = {}, {}
    cache.mkdir(parents=True, exist_ok=True)
    for name, pin in pins.items():
        require(host in pin, f"unsupported scanner host: {host}")
        archive = cache / f"{name}_{pin['version']}_{host}.tar.gz"
        if not archive.exists():
            archive.write_bytes(download(f"https://github.com/anchore/{name}/releases/download/"
                                         f"v{pin['version']}/{archive.name}"))
        require(sha256(archive) == pin[host], f"{name} archive checksum mismatch")
        with tarfile.open(fileobj=io.BytesIO(archive.read_bytes())) as bundle:
            member = bundle.getmember(name)
            require(member.isfile(), "tool archive member is not a regular file")
            binary = bundle.extractfile(member).read()
        destination = cache / name
        destination.write_bytes(binary)
        destination.chmod(0o755)
        paths[name] = destination.resolve()
        evidence[name] = {"version": pin["version"], "archive_sha256": pin[host],
                          "binary_sha256": sha256(destination), "platform": host}
    return paths, evidence


def scanner_environment(db_cache):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GRYPE_", "SYFT_"))}
    env.update({"GRYPE_DB_CACHE_DIR": str(db_cache.resolve()),
                "GRYPE_CHECK_FOR_APP_UPDATE": "false", "SYFT_CHECK_FOR_APP_UPDATE": "false"})
    return env


def scan_sbom(tools, sbom, output, env):
    config = output / "grype.yaml"
    config.write_text("""check-for-app-update: false
only-fixed: false
only-notfixed: false
ignore: []
exclude: []
db:
  auto-update: false
  validate-age: true
  validate-by-hash-on-start: true
  max-allowed-built-age: 24h
  require-update-check: true
  max-update-check-frequency: 0s
match:
  stock:
    using-cpes: true
""")
    # Update must succeed even when an existing database is young enough.
    command([tools["grype"], "db", "update", "--config", config], env=env,
            output=output / "db-update.txt")
    raw = command([tools["grype"], "db", "status", "-o", "json", "--config", config],
                  env=env, output=output / "db.json")
    status = json.loads(raw)
    before = database(status, dt.datetime.now(dt.timezone.utc))
    db_path = Path(status["path"])
    before["sha256"] = sha256(db_path)
    command([tools["grype"], f"sbom:{sbom.resolve()}", "--config", config, "-o", "json"],
            env=env, output=output / "grype.json")
    require(sha256(db_path) == before["sha256"], "database changed during scan")
    # Measure again at the end; a scan crossing the freshness boundary fails.
    before.update(database(status, dt.datetime.now(dt.timezone.utc)))
    write_json(output / "db-evidence.json", before)
    return json.loads((output / "grype.json").read_text())


def query_runtimes(coverage, output):
    findings = []
    for runtime, ecosystem, name in [("go", "Go", "stdlib"), ("uv", "PyPI", "uv")]:
        version = coverage["versions"][runtime]
        query = {"package": {"ecosystem": ecosystem, "name": name}, "version": version}
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        response = json.loads(download("https://api.osv.dev/v1/query", 10 * 1024 * 1024,
                                       json.dumps(query).encode()))
        write_json(output / f"{runtime}-advisories.json", {"query": query, "response": response,
                   "queried_at": started})
        findings += osv_findings(response, name, ecosystem, version)
    return findings


def evaluate(findings, trusted_policy, candidate_policy, output):
    require(trusted_policy.is_file() and candidate_policy.is_file(), "exception policy missing")
    require(trusted_policy.read_bytes() == candidate_policy.read_bytes(),
            "candidate changes exception policy; land reviewed policy separately then rerun")
    write_json(output / "policy-input.json", {"sha256": sha256(trusted_policy)})
    write_json(output / "findings.json", findings)
    command(["node", ROOT / "scripts/security/image-policy.mjs", trusted_policy,
             output / "findings.json", output / "policy-result.json"])
    result = json.loads((output / "policy-result.json").read_text())
    require(isinstance(result.get("blocking"), list), "invalid shared policy result")
    return result


def bundle_manifest(output, identity):
    # All evidence is bound to one image. Daily rescans verify these retained bytes.
    files = ["sbom.syft.json", "runtime.json", "identity.json", "coverage.json"]
    write_json(output / "bundle.json", {"schema_version": 1, "image": identity,
               "files": {name: sha256(output / name) for name in files}})


def load_bundle(bundle, output):
    manifest = json.loads((bundle / "bundle.json").read_text())
    require(manifest.get("schema_version") == 1, "unknown evidence bundle")
    require(set(manifest.get("files", {})) ==
            {"sbom.syft.json", "runtime.json", "identity.json", "coverage.json"}, "incomplete bundle")
    for name, digest in manifest["files"].items():
        require(sha256(bundle / name) == digest, f"retained evidence hash mismatch: {name}")
        (output / name).write_bytes((bundle / name).read_bytes())
    identity = json.loads((output / "identity.json").read_text())
    require(identity["image"] == manifest["image"], "retained identity mismatch")
    return identity


def run(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    try:
        require(re.fullmatch(r"[0-9a-f]{40}", args.source_revision) is not None,
                "source revision must be a full Git commit SHA")
        require(re.fullmatch(r"sha256:[0-9a-f]{64}", args.image) is not None,
                "use an immutable loaded image ID (sha256:...), never a tag")
        if args.bundle:
            identity = load_bundle(args.bundle.resolve(), output)
            require(identity["image"] == args.image, "rescan image differs from retained candidate")
            require(identity["source_revision"] == args.source_revision, "rescan source revision mismatch")
        else:
            details = json.loads(command(["docker", "image", "inspect", args.image]))
            require(len(details) == 1 and details[0]["Id"] == args.image, "loaded image identity mismatch")
            require(details[0]["Architecture"] == "amd64" and details[0]["Os"] == "linux",
                    "managed image must be linux/amd64")
            identity = {"image": args.image, "repo_digests": details[0].get("RepoDigests", []),
                        "source_revision": args.source_revision, "inspected": details[0]}
            write_json(output / "identity.json", identity)
            raw = command(["docker", "run", "--rm", "--network=none", "--read-only",
                           "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64",
                           "--entrypoint=/usr/bin/python3", args.image, "-c", PROBE],
                          output=output / "runtime.json", timeout=120)
            json.loads(raw)
        tools, pins = install_tools(args.tool_cache.resolve())
        write_json(output / "tools.json", pins)
        env = scanner_environment(args.db_cache)
        if not args.bundle and "DOCKER_HOST" not in env:
            env["DOCKER_HOST"] = command(["docker", "context", "inspect", "--format",
                                         "{{.Endpoints.docker.Host}}"]).strip()
        if not args.bundle:
            syft_config = output / "syft.yaml"
            syft_config.write_text("check-for-app-update: false\nexclude: []\n")
            command([tools["syft"], "scan", f"docker:{args.image}", "--config", syft_config,
                     "-o", f"syft-json={output / 'sbom.syft.json'}"], env=env,
                    output=output / "syft.txt", timeout=1800)
        sbom = json.loads((output / "sbom.syft.json").read_text())
        raw_runtime = json.loads((output / "runtime.json").read_text())
        require(raw_runtime.get("nac", "").strip().endswith(f"({args.source_revision[:12]})"),
                "NAC binary source revision does not match candidate")
        coverage = inventory(sbom, raw_runtime, args.image)
        write_json(output / "coverage.json", coverage)
        bundle_manifest(output, args.image)
        report = scan_sbom(tools, output / "sbom.syft.json", output, env)
        findings = grype_findings(report, sbom) + query_runtimes(coverage, output)
        result = evaluate(findings, args.trusted_policy, args.candidate_policy, output)
        write_report(output / "report.md", result, args.image)
        write_json(output / "result.json", {"status": "blocked" if result["blocking"] else "passed",
                   "image": args.image, "scanned_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                   "blocking": len(result["blocking"]), "findings": len(findings)})
        return 1 if result["blocking"] else 0
    except Exception as error:
        write_json(output / "result.json", {"status": "error", "image": args.image, "error": str(error)})
        print(f"image security failed closed: {error}", file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--trusted-policy", required=True, type=Path)
    parser.add_argument("--candidate-policy", required=True, type=Path)
    parser.add_argument("--bundle", type=Path, help="rescan retained SBOM/probes without rebuilding")
    parser.add_argument("--tool-cache", type=Path, default=Path(tempfile.gettempdir()) / "nac-image-tools")
    parser.add_argument("--db-cache", type=Path, default=Path(tempfile.gettempdir()) / "nac-image-db")
    return run(parser.parse_args())


if __name__ == "__main__":
    sys.exit(main())
