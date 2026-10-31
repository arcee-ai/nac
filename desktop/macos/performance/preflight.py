#!/usr/bin/env python3
"""Read-only ALL-353 prerequisite capture. Never launches or qualifies a workload."""

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import subprocess


ROOT = Path(__file__).resolve().parents[3]


def console_fields(data):
    root = plistlib.loads(data)
    if isinstance(root, list):
        root = root[0]
    return [{k: row[k] for k in (
        "CGSSessionScreenIsLocked", "kCGSSessionOnConsoleKey", "kCGSSessionLoginDoneKey")
             if k in row} for row in root.get("IOConsoleUsers", [])]


def run(argv):
    try:
        result = subprocess.run(argv, capture_output=True, timeout=30, check=False)
        return result.returncode, result.stdout, result.stderr
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, b"", type(error).__name__.encode()


def capture():
    observations = {}
    operations = []

    def probe(name, argv, decode):
        code, out, err = run(argv)
        entry = {"name": name, "argv": argv, "exit_code": code}
        if code == 0:
            try:
                observations[name] = decode(out)
            except (ValueError, KeyError, IndexError, TypeError, plistlib.InvalidFileException):
                entry["parse_error"] = True
        else:
            # Only developer-tool lookup errors are safe to retain verbatim.
            if name == "xctrace":
                entry["error"] = err.decode(errors="replace").strip()[:600]
        operations.append(entry)

    probe("source", ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
          lambda b: b.decode().strip())
    probe("dirty", ["git", "-C", str(ROOT), "status", "--porcelain"], bool)
    manifest = ROOT / "desktop/macos/performance/workloads.json"
    observations["workloads_sha256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    if platform.system() == "Darwin":
        probe("os", ["/usr/bin/sw_vers", "-productVersion"], lambda b: b.decode().strip())
        probe("os_build", ["/usr/bin/sw_vers", "-buildVersion"], lambda b: b.decode().strip())
        probe("hardware", ["/usr/sbin/system_profiler", "SPHardwareDataType", "-json"],
              lambda b: {k: v for k, v in json.loads(b)["SPHardwareDataType"][0].items()
                         if k in {"machine_model", "chip_type", "number_processors", "physical_memory"}})
        probe("displays", ["/usr/sbin/system_profiler", "SPDisplaysDataType", "-json"],
              lambda b: [{k: v for k, v in d.items() if k in {
                  "_spdisplays_pixels", "_spdisplays_resolution", "spdisplays_main",
                  "spdisplays_online", "spdisplays_mirror", "spdisplays_ambient_brightness"}}
                  for gpu in json.loads(b)["SPDisplaysDataType"]
                  for d in gpu.get("spdisplays_ndrvs", [])])
        probe("console", ["/usr/sbin/ioreg", "-n", "Root", "-d1", "-a"], console_fields)
        probe("developer_dir", ["/usr/bin/xcode-select", "-p"], lambda b: b.decode().strip())
        probe("xctrace", ["/usr/bin/xcrun", "--find", "xctrace"], lambda b: b.decode().strip())
        probe("virtual_machine", ["/usr/sbin/sysctl", "-n", "kern.hv_vmm_present"],
              lambda b: b.decode().strip())
        probe("power", ["/usr/bin/pmset", "-g", "batt"],
              lambda b: b.decode().splitlines()[0])
    console = observations.get("console", [])
    unlocked = any(row.get("CGSSessionScreenIsLocked") is False
                   and row.get("kCGSSessionOnConsoleKey") is True for row in console)
    locked = any(row.get("CGSSessionScreenIsLocked") is True for row in console)
    blockers = []
    if platform.system() != "Darwin":
        blockers.append("Actual AppKit/WKWebView requires macOS")
    if locked or not unlocked:
        blockers.append("Unlocked active console not established; no active-window baseline")
    if "xctrace" not in observations:
        blockers.append("Selected developer tools cannot locate xctrace")
    return {
        "schema": "nac-mac-performance-preflight-v1",
        "captured_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "architecture": platform.machine(),
        "observations": observations,
        "operations": operations,
        "blockers": blockers,
        "decision": "NO-GO" if blockers else "PREREQUISITES-ONLY",
        "measurement_samples": 0,
        "qualification": "No renderer, trusted input, isolation, or performance qualification performed",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New sanitized JSON file; never overwritten")
    args = parser.parse_args()
    report = capture()
    with args.output.open("x") as destination:
        json.dump(report, destination, indent=2, sort_keys=True)
        destination.write("\n")
    print(json.dumps({k: report[k] for k in ("decision", "blockers", "measurement_samples")}))
    raise SystemExit(2 if report["blockers"] else 0)
