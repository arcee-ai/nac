#!/usr/bin/env python3
"""Select only a reviewed native Engine path; uncertainty keeps the original driver."""
import json
import os
import re
import selectors
import signal
import subprocess
import time

MAX_OUTPUT = 64 * 1024
TIMEOUT = 10
INFO = ('{"ServerVersion":{{json .ServerVersion}},"OSType":{{json .OSType}},'
        '"Architecture":{{json .Architecture}},"Driver":{{json .Driver}},'
        '"DriverStatus":{{json .DriverStatus}}}')


def query(arguments):
    """Bound both time and bytes; never invoke a shell or print daemon data."""
    process = subprocess.Popen(["docker", *arguments], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    finished = False
    try:
        deadline, output = time.monotonic() + TIMEOUT, bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise ValueError("capability query timed out")
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > MAX_OUTPUT:
                    raise ValueError("capability query exceeds bound")
        status = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        finished = True
        if status:
            raise ValueError("capability query failed")
        return output.decode("utf-8").strip()
    finally:
        try:
            if not finished:
                # Docker's buildx plugin is a child too. This new session owns
                # only the CLI invocation, never the Engine, daemon or builder.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=1)
        finally:
            process.stdout.close()


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate capability field")
        value[key] = item
    return value


def supported(info, version, context, inspection):
    if not isinstance(info, dict) or set(info) != {
            "ServerVersion", "OSType", "Architecture", "Driver", "DriverStatus"}:
        return False
    # Reviewed Engine family and preinstalled hosted CLI. Future/other versions
    # use docker-container until their capability/source contract is reviewed.
    if not isinstance(info["ServerVersion"], str) or not re.fullmatch(r"29\.\d+\.\d+", info["ServerVersion"]):
        return False
    if (info["OSType"], info["Architecture"], info["Driver"]) != ("linux", "x86_64", "overlayfs"):
        return False
    status = info["DriverStatus"]
    if not isinstance(status, list) or not 0 < len(status) <= 32:
        return False
    if any(not isinstance(row, list) or len(row) != 2 or
           any(not isinstance(v, str) or len(v) > 256 for v in row) for row in status):
        return False
    if len({row[0] for row in status}) != len(status):
        return False
    if dict(status).get("driver-type") != "io.containerd.snapshotter.v1":
        return False
    if not re.fullmatch(r"github\.com/docker/buildx v0\.38\.1 [a-f0-9]{7,64}", version):
        return False
    if context != "default" or inspection.splitlines().count("Nodes:") != 1:
        return False
    if re.search(r"(?m)^\s*Error:", inspection):
        return False
    fields = {}
    for line in inspection.splitlines():
        match = re.fullmatch(r"(Name|Driver|Endpoint|Status|BuildKit version|Platforms):[ \t]+([^\r\n]+)", line)
        if match:
            fields.setdefault(match[1], []).append(match[2].strip())
    for key, expected in {"Name": ["default", "default"], "Driver": ["docker"],
                          "Endpoint": ["default"], "Status": ["running"]}.items():
        if fields.get(key) != expected:
            return False
    versions, platforms = fields.get("BuildKit version", []), fields.get("Platforms", [])
    if len(versions) != 1 or len(platforms) != 1:
        return False
    release = re.fullmatch(r"v0\.(\d+)\.\d+", versions[0])
    # GHA v2 requires BuildKit >=0.20; do not silently accept future families.
    if not release or not 20 <= int(release[1]) <= 34:
        return False
    return "linux/amd64" in [value.strip() for value in platforms[0].split(",")]


def select():
    try:
        info = json.loads(query(["info", "--format", INFO]), object_pairs_hook=unique)
        version = query(["buildx", "version"])
        context = query(["context", "show"])
        # The context is never interpolated into a command or workflow output.
        if context == "default" and supported(info, version, context,
                                               query(["buildx", "inspect", "default"])):
            return "docker"
    except (OSError, ValueError, TypeError, OverflowError, RecursionError, subprocess.SubprocessError):
        pass
    return "docker-container"


if __name__ == "__main__":
    print("driver=" + select())
