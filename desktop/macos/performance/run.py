#!/usr/bin/env python3
"""Finite ALL-353 calibration/collection; no implicit measurement approval."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import resource
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
SHA = re.compile(r"[0-9a-f]{40}\Z")
MAX_EXPORT_BYTES = 64 * 1024 * 1024


def read_json(path):
    if path.is_symlink() or path.stat().st_size > 2_000_000:
        raise ValueError("Unbounded or symlinked JSON input")
    return json.loads(path.read_text())


def write_json(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_contract(contract, workloads):
    if contract.get("schema") != "nac-mac-performance-allocation-v2":
        raise ValueError("Unsupported allocation schema")
    phases = contract["phases"]
    if len({p["name"] for p in phases}) != len(phases):
        raise ValueError("Duplicate phase")
    if any(type(p["cap_seconds"]) is not int or p["cap_seconds"] <= 0 for p in phases):
        raise ValueError("Invalid phase guard")
    if sum(p["cap_seconds"] for p in phases) != contract["core_cap_seconds"] or contract["core_cap_seconds"] != 12600:
        raise ValueError("Core cap must include all phases and equal12600s")
    if contract["core_cap_seconds"] + contract["upload_cleanup_envelope_seconds"] > contract["workflow_timeout_minutes"] * 60:
        raise ValueError("Cleanup envelope exceeds workflow guard")
    if contract["workflow_timeout_minutes"] > 360:
        raise ValueError("Allocation exceeds six hours")
    if contract["trusted_input_events"] != 100 or workloads["input"]["trusted_events_per_block"] != 100:
        raise ValueError("Required100 input events changed")
    if contract["paired_blocks"] != 20 or contract["idle_seconds"] != 30:
        raise ValueError("Unapproved repetition/idle revision")
    if contract["input_batch_characters"] != 1:
        raise ValueError("Batching requires measured calibration and explicit revision")
    if set(contract["required_raw_signals"]) != {"memory", "cpu", "wakeups", "queue", "frame", "input_latency"}:
        raise ValueError("Required signal removed")
    if set(contract["required_process_roles"]) != {"shell", "webcontent", "network", "gpu", "backend", "provider", "pty"}:
        raise ValueError("Required process role removed")
    return {p["name"]: p["cap_seconds"] for p in phases}


def require_approval(contract, target, harness, reference):
    if not all(SHA.fullmatch(x or "") for x in (target, harness)):
        raise ValueError("Exact full source identities required")
    if (contract.get("nominated_target_sha") != target or contract.get("nominated_harness_sha") != harness
            or not reference or contract.get("dispatch_reference") != reference):
        raise ValueError("Target/harness nomination and separate dispatch approval are absent or mismatched")


def require_calibration_result(summary):
    if (summary.get("totalTestCount") != 1 or summary.get("passedTests") != 1
            or summary.get("failedTests") != 0 or summary.get("skippedTests") != 0
            or summary.get("result") != "Passed"):
        raise ValueError("Actual XCTest result must contain one passed, unskipped calibration case")


def classify_cpu_unit(before, after, independent_cpu_ns):
    """Clock-unit calibration only; tolerance is not a product CPU budget."""
    try:
        if (before["status"] != "observed" or after["status"] != "observed"
                or before["identity"] != after["identity"] or independent_cpu_ns < 50_000_000):
            raise ValueError("Missing/unstable independent CPU control")
        raw = sum(int(after[k]) - int(before[k]) for k in ("cpu_user_raw", "cpu_system_raw"))
        numer, denom = after["timebase_numer"], after["timebase_denom"]
        if raw <= 0 or numer <= 0 or denom <= 0 or (numer, denom) != (before["timebase_numer"], before["timebase_denom"]):
            raise ValueError("CPU control counters or timebase changed")
        hypotheses = {"nanoseconds": 1.0, "mach_absolute_ticks": numer / denom}
        valid = {name: factor for name, factor in hypotheses.items()
                 if abs(raw * factor - independent_cpu_ns) / independent_cpu_ns <= .15}
        if not valid or len(valid) > 1 and numer != denom:
            raise ValueError("CPU clock-unit observation unavailable or ambiguous")
        name, factor = next(iter(valid.items()))
        return {"status": "observed", "raw_unit": name, "nanoseconds_per_raw_unit": factor,
                "independent_cpu_ns": independent_cpu_ns, "raw_delta": raw,
                "calibration_relative_tolerance": .15, "product_cpu_budget": None}
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return {"status": "unavailable", "reason": "CPU unit control failed; raw counters stay unconverted"}


def signal_completeness(contract, observations):
    missing = []
    units = {"memory": "bytes", "cpu": "core_percent", "wakeups": "wakeups_per_second",
             "queue": "items", "frame": "ms", "input_latency": "ms"}
    for name in contract["required_raw_signals"]:
        value = observations.get(name)
        rows = value.get("samples") if isinstance(value, dict) else None
        valid = (isinstance(value, dict) and value.get("status") == "observed"
                 and value.get("unit") == units[name] and isinstance(rows, list) and 0 < len(rows) <= 100_000)
        if valid:
            valid = all(isinstance(row, dict) and row.get("identity_verified") is True
                and row.get("status") == "observed" and type(row.get("value")) in (int, float)
                and math.isfinite(row["value"]) and row["value"] >= 0 for row in rows)
        if not valid:
            missing.append(name)
    return {"raw_signal_coverage_complete": not missing, "missing_raw_signals": missing}


def paired_distribution(samples, expected_pairs=20):
    """Summarize only complete finite pairs. Null/failure never becomes zero."""
    pairs = {}
    scopes = set()
    for sample in samples:
        value = sample.get("value")
        if (sample.get("status") != "observed" or type(value) not in (int, float)
                or not math.isfinite(value) or value < 0):
            raise ValueError("Missing, failed, nonfinite or invalid observation")
        key, arm = sample["pair"], sample["arm"]
        if type(key) is not int or key not in range(expected_pairs) or arm not in ("native", "browser"):
            raise ValueError("Invalid pair/arm")
        group = pairs.setdefault(key, {})
        if arm in group:
            raise ValueError("Duplicate paired observation")
        group[arm] = value
        scopes.add((sample.get("unit"), sample.get("workload"), sample.get("hardware_class"), sample.get("window_state")))
    if len(scopes) != 1 or any(not isinstance(v, str) or not v for v in next(iter(scopes))):
        raise ValueError("Missing or mixed measurement scope/units")
    if len(pairs) != expected_pairs or any(set(v) != {"native", "browser"} for v in pairs.values()):
        raise ValueError("Incomplete paired distribution; retain attempts separately")
    def stats(values):
        ordered = sorted(values)
        return {"n": len(ordered), "p50": ordered[math.ceil(.5 * len(ordered)) - 1],
                "p95": ordered[math.ceil(.95 * len(ordered)) - 1], "min": ordered[0], "max": ordered[-1]}
    return {arm: stats([v[arm] for v in pairs.values()]) for arm in ("native", "browser")} | {
        "paired_native_minus_browser": stats([v["native"] - v["browser"] for v in pairs.values()])}


class OwnedCommand:
    def __init__(self, argv, env, cwd, log):
        executable = shutil.which(argv[0], path=env.get("PATH"))
        if executable is None:
            raise ValueError("Owned command executable unavailable")
        self.executable = str(Path(executable).resolve())
        self.log = log.open("xb")
        try:
            self.launch_before_us = time.time_ns() // 1000
            self.process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
            self.launch_after_us = time.time_ns() // 1000 + 1
        except BaseException:
            self.log.close()
            raise

    def sampling_receipt(self):
        return {"kind": "owned_child", "pid": self.process.pid, "executable": self.executable,
                "launch_window_us": (self.launch_before_us, self.launch_after_us), "handle": self.process}

    def stop(self):
        # Popen retains our child; never signal by executable name or a stale
        # PID found in a transcript. Only this created process group is used.
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=25)
            except subprocess.TimeoutExpired:
                if self.process.poll() is None:
                    os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.log.close()


class Sampler:
    """One bounded sampler for this calibration, not a general profiler service."""
    def __init__(self, binary, destination, ui_output, runner):
        self.binary, self.destination, self.ui_output, self.runner = binary, destination, ui_output, runner
        self.roots = {}
        self.stop_event = threading.Event()
        self.error = None
        self.thread = threading.Thread(target=self.loop)

    def add(self, pid, role, receipt=None):
        entry = {"role": role, "receipt": dict(receipt) if receipt else None}
        if pid in self.roots and self.roots[pid] != entry:
            self.roots[pid]["conflict"] = True
        else:
            self.roots.setdefault(pid, entry)

    def unavailable(self, pid, entry, reason, **extra):
        return {"schema": "nac-mac-process-v1", "pid": pid, "status": "unavailable", "reason": reason,
                "requested_role": entry["role"], "role": None, "attributed": False, "full_process_set": False,
                **{k: None for k in ("identity", "cpu_user_raw", "cpu_system_raw", "resident_bytes",
                    "physical_footprint_bytes", "package_idle_wakeups", "interrupt_wakeups")}, **extra}

    def sample(self, pid, entry):
        receipt = entry.get("receipt") or {}
        kind = receipt.get("kind")
        if (entry.get("conflict") or receipt.get("pid") != pid
                or not isinstance(receipt.get("executable"), str) or not Path(receipt["executable"]).is_absolute()
                or kind not in ("owned_child", "current_process", "xcui_launch")):
            return self.unavailable(pid, entry, "missing_or_conflicting_launch_receipt")
        handle = receipt.get("handle")
        if kind == "owned_child" and (handle is None or handle.pid != pid):
            return self.unavailable(pid, entry, "owned_handle_missing_or_mismatched")
        def live():
            return (handle is not None and handle.pid == pid and handle.poll() is None) if kind == "owned_child" else (
                pid == os.getpid() if kind == "current_process" else True)
        if not live():
            return self.unavailable(pid, entry, "owned_handle_no_longer_live",
                                    owned_incarnation_dead=kind == "owned_child")
        if kind == "xcui_launch" and not str(receipt.get("launch_unix_us", "")).isdigit():
            return self.unavailable(pid, entry, "launch_incarnation_unknown")
        argv = [str(self.binary), "--pid", str(pid)]
        result = subprocess.run(argv, capture_output=True, timeout=3, check=False)
        if result.returncode not in (0, 2) or len(result.stdout) > 16384:
            raise ValueError("Process probe failed or exceeded bounded output")
        row = json.loads(result.stdout)
        if (row.get("schema") != "nac-mac-process-v1" or row.get("pid") != pid
                or row.get("status") not in ("observed", "unavailable")):
            raise ValueError("Process probe schema/PID binding mismatch")
        if row["status"] != "observed":
            return self.unavailable(pid, entry, row.get("reason", "probe_unavailable"), errno=row.get("errno"))
        if not live():
            return self.unavailable(pid, entry, "owned_handle_exited_during_probe", owned_incarnation_dead=kind == "owned_child")
        try:
            birth = int(row["identity"]["start_wall_seconds"]) * 1_000_000 + int(row["identity"]["start_wall_microseconds"])
            same_executable = Path(row["executable"]).is_absolute() and Path(row["executable"]).resolve() == Path(receipt["executable"]).resolve()
            same_birth = (receipt["launch_window_us"][0] <= birth <= receipt["launch_window_us"][1]
                          if kind == "owned_child" else abs(birth - int(receipt["launch_unix_us"])) <= 1
                          if kind == "xcui_launch" else True)
            start = row["identity"]["start_mach_ticks"]
            valid = same_executable and same_birth and str(start).isdigit() and int(start) > 0
        except (KeyError, TypeError, ValueError, OSError):
            valid = False
        if not valid:
            return self.unavailable(pid, entry, "launch_executable_or_incarnation_mismatch")
        return row | {"role": entry["role"], "sample_time_ns": time.monotonic_ns(),
                      "attributed": True, "ownership_evidence": kind, "full_process_set": False}

    def loop(self):
        try:
            with self.destination.open("x") as output:
                for _ in range(300):
                    if self.stop_event.is_set():
                        break
                    if self.ui_output.exists():
                        ui = read_json(self.ui_output)
                        for row in ui.get("observations", []):
                            if row.get("event") == "app_launched":
                                self.add(int(row["pid"]), "shell", {"kind": "xcui_launch", "pid": row["pid"],
                                    "executable": row.get("executable"), "launch_unix_us": row.get("launch_unix_us")})
                    # Discovery is explicitly incomplete for reparented XPC
                    # helpers; no global name match becomes owned attribution.
                    table = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,comm="],
                        capture_output=True, text=True, timeout=3, check=True).stdout
                    unbound = []
                    for line in table.splitlines():
                        parts = line.strip().split(None, 2)
                        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
                            pid, parent = int(parts[0]), int(parts[1])
                            if parent in self.roots and pid not in self.roots:
                                unbound.append({"pid": pid, "name": Path(parts[2]).name,
                                                "ownership": "no_owned_launch_receipt", "included_in_app_totals": False})
                            elif pid not in self.roots and any(tag in parts[2] for tag in ("WebKit", "WebContent", "Safari")):
                                unbound.append({"pid": pid, "name": Path(parts[2]).name,
                                                "ownership": "unbound", "included_in_app_totals": False})
                    if len(self.roots) > 128:
                        raise ValueError("Calibration process registry full")
                    output.write(json.dumps({"event": "unattributed_helper_candidates", "candidates": unbound[:128],
                        "omitted": max(0, len(unbound) - 128), "full_process_set": False}) + "\n")
                    for pid, entry in list(self.roots.items()):
                        output.write(json.dumps(self.sample(pid, entry), sort_keys=True) + "\n")
                    output.flush()
                    self.stop_event.wait(1)
        except BaseException as error:
            self.error = type(error).__name__

    def close(self):
        self.stop_event.set()
        self.thread.join(timeout=30)
        if self.thread.is_alive():
            raise ValueError("Sampler failed to stop; evidence incomplete")


class Calibration:
    def __init__(self, args, contract, epoch):
        self.args, self.contract = args, contract
        self.caps = validate_contract(contract, read_json(HERE / "workloads.json"))
        self.start = epoch
        self.deadline = epoch + contract["core_cap_seconds"]
        self.work_deadline = self.deadline - self.caps["cleanup_and_evidence_export"] - self.caps["summary_and_final_receipts"]
        self.phase_deadline = self.deadline
        self.private = args.output.parent / (args.output.name + "-private")
        self.private.mkdir(mode=0o700)
        self.owned = []
        self.sampler = None
        self.report = {"schema": "nac-mac-performance-attempt-v1", "scope": "calibration only",
            "nac_performance_trials": 0, "numerical_product_budgets": None,
            "measurement_ready": False,
            "missing_required_cells": contract["required_cells"], "commands": [],
            "known_unavailable": contract["known_unavailable"], "cleanup": [],
            "workloads_sha256": digest(HERE / "workloads.json"), "allocation_sha256": digest(args.contract)}

    def phase(self, name):
        origin = self.start if name == "setup_and_private_release_build" else time.monotonic()
        self.phase_deadline = min(self.deadline, origin + self.caps[name])
        self.report.setdefault("phases", []).append({"name": name, "started_ns": time.monotonic_ns()})

    def remaining(self):
        value = min(self.work_deadline, self.phase_deadline) - time.monotonic()
        if value <= 0:
            raise TimeoutError("Experiment phase/core guard reached; no partial pass")
        return value

    def command(self, argv, name, cwd=None, env=None, limit=120):
        item = OwnedCommand(argv, env or os.environ.copy(), cwd or self.args.source_root,
                            self.private / (name + ".log"))
        self.owned.append(item)
        status = None
        try:
            status = item.process.wait(timeout=min(limit, self.remaining()))
            if status != 0:
                raise ValueError("Command failed: " + name)
        finally:
            item.stop()
            self.owned.remove(item)
            self.report["commands"].append({"name": name, "argv": argv, "exit_code": status})

    def checkout(self, root, expected):
        actual = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True)
        if actual != expected or dirty:
            raise ValueError("Candidate checkout identity or cleanliness mismatch")
        return {"source_sha": actual, "dirty": False}

    def environment(self, home, provider):
        for name in ("home", "nac-home", "xdg", "tmp"):
            (home / name).mkdir(parents=True, mode=0o700)
        return {"HOME": str(home / "home"), "NAC_HOME": str(home / "nac-home"),
            "XDG_CONFIG_HOME": str(home / "xdg"), "TMPDIR": str(home / "tmp"),
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
            "NAC_ORCHESTRATION": "0", "NAC_TELEMETRY": "disabled", "BROWSER": "none",
            "MODELS_DEV_URL": provider + "/models-dev", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null"}

    def launch_backend(self, engine, workspace, store, env, name):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        argv = [str(engine), "--bind", f"127.0.0.1:{port}", "--directory", str(workspace),
                "--store-path", str(store), "--worker-executable", str(engine), "--no-open"]
        item = OwnedCommand(argv, env, workspace, self.private / (name + ".log"))
        self.owned.append(item)
        base = f"http://127.0.0.1:{port}"
        end = min(time.monotonic() + 30, self.phase_deadline)
        while time.monotonic() < end:
            if item.process.poll() is not None:
                raise ValueError("Exact owned backend exited; never adopt another listener")
            listener = subprocess.run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(item.process.pid),
                "-iTCP", "-sTCP:LISTEN", "-Fn"], capture_output=True, text=True, timeout=3)
            if f"n127.0.0.1:{port}\n" in listener.stdout:
                try:
                    with urlopen(base + "/health", timeout=1) as response:
                        if response.status == 200 and item.process.poll() is None:
                            return item, base
                except OSError:
                    pass
            time.sleep(.1)
        raise TimeoutError("Exact backend listener/readiness unavailable")

    def api(self, base, path, body):
        request = Request(base + "/" + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urlopen(request, timeout=min(10, self.remaining())) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError("Fixture API response exceeded cap")
        return json.loads(data)

    def build(self):
        self.phase("setup_and_private_release_build")
        self.report["target"] = self.checkout(self.args.source_root, self.args.target_sha)
        self.report["harness"] = self.checkout(self.args.harness_root, self.args.harness_sha)
        self.report["tools"] = self.checkout(HERE.parents[2], self.args.tools_sha)
        self.command(["make", "setup"], "setup", limit=600)
        env = os.environ.copy()
        env.update(NAC_SOURCE_REVISION=self.args.target_sha, NAC_BUILD_TRACK="dev",
                   CARGO_TARGET_DIR=str(self.private / "cargo"), CARGO_BUILD_JOBS="4")
        self.command(["cargo", "build", "--release", "--locked", "-p", "nac-server", "--bin", "nac-web"],
                     "release-engine", env=env, limit=900)
        engine = self.private / "nac-web"
        shutil.copy2(self.private / "cargo/release/nac-web", engine)
        env.update(NAC_MAC_SKIP_ENGINE_BUILD="1", NAC_MAC_ENGINE=str(engine), NAC_MAC_OUTPUT=str(self.private / "app"))
        self.command(["bash", "desktop/macos/preview.sh", "app-build"], "ordinary-app", env=env)
        app = self.private / "app/NAC.app"
        receipt_file = app / "Contents/Resources/build-receipt.json"
        if not receipt_file.is_file():
            raise ValueError("Ordinary builder source/flags receipt missing")
        receipt = read_json(receipt_file)
        self.report["build_receipt"] = receipt
        self.report["engine_sha256"] = digest(engine)
        if digest(app / "Contents/Resources/nac-web") != self.report["engine_sha256"]:
            raise ValueError("Browser/native engine bytes differ")
        if (receipt.get("source_head") != self.args.target_sha or receipt.get("source_dirty") is not False
                or receipt.get("mode") != "app-build" or receipt.get("normal_startup") is not True
                or receipt.get("smoke_instrumentation") is not False
                or receipt.get("preview_definitions_excluded") is not True
                or receipt.get("engine_sha256") != self.report["engine_sha256"]
                or receipt.get("native_sha256") != digest(app / "Contents/MacOS/NACPreview")):
            raise ValueError("Normal release source-list/binary identity receipt mismatch")
        self.report["embedded_asset_tree"] = subprocess.check_output(["git", "-C", str(self.args.source_root),
            "rev-parse", "HEAD:crates/nac-server/assets/dist"], text=True).strip()
        self.report["cargo_lock_sha256"] = digest(self.args.source_root / "Cargo.lock")
        project = self.args.harness_root / "desktop/macos/NativeUITests/NACNativeUITests.xcodeproj"
        if "NAC_PERFORMANCE_SOURCE" not in (project / "project.pbxproj").read_text():
            raise ValueError("ALL-354 integration of allocated PerformanceJourneys.swift is missing")
        self.command(["xcrun", "clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
            str(HERE / "process_usage.c"), "-o", str(self.private / "process-usage")], "process-probe-build")
        for name, argv in (("rust", ["rustc", "-Vv"]), ("xcode", ["xcodebuild", "-version"]),
                           ("sdk", ["xcrun", "--show-sdk-version"]), ("os", ["sw_vers"])):
            self.command(argv, name + "-identity")
        return engine, app, project

    def observe_policy(self):
        # Reuse the owned, pinned ALL-354 observation policy. It uses only
        # existing noninteractive read access and never requests a grant.
        sys.path.insert(0, str(self.args.harness_root / "desktop/macos"))
        from ci_xctest import authorization_policy, observe_prerequisites
        def capture(argv):
            result = subprocess.run(argv, capture_output=True, timeout=min(10, self.remaining()), check=True)
            if len(result.stdout) > 128_000:
                raise ValueError("Prerequisite observation exceeds cap")
            return result.stdout.decode()
        observation = observe_prerequisites(capture)
        return authorization_policy(observation)

    def cpu_control(self):
        probe = Sampler(self.private / "process-usage", Path("unused"), Path("unused"), self)
        entry = {"role": "observer", "receipt": {"kind": "current_process", "pid": os.getpid(),
                                                   "executable": str(Path(sys.executable).resolve())}}
        before = probe.sample(os.getpid(), entry)
        initial = resource.getrusage(resource.RUSAGE_SELF)
        cpu_start = time.process_time()
        while time.process_time() - cpu_start < .25:
            self.remaining()
            sum(i * i for i in range(1000))
        final = resource.getrusage(resource.RUSAGE_SELF)
        after = probe.sample(os.getpid(), entry)
        observed_ns = round(((final.ru_utime + final.ru_stime) - (initial.ru_utime + initial.ru_stime)) * 1_000_000_000)
        receipt = classify_cpu_unit(before, after, observed_ns)
        write_json(self.private / "cpu-unit-control.json", receipt)
        return receipt

    def fixture(self, engine):
        provider = OwnedCommand([sys.executable, "-B", str(HERE / "fixture.py"), "--mode", "stream",
            "--evidence", str(self.private / "provider.jsonl")], os.environ.copy(), HERE,
            self.private / "provider-start.log")
        self.owned.append(provider)
        for _ in range(50):
            self.remaining()
            try:
                base = json.loads((self.private / "provider-start.log").read_text().splitlines()[0])["base_url"]
                break
            except (IndexError, ValueError):
                time.sleep(.1)
        else:
            raise ValueError("Local dummy provider did not bind")
        workspace = self.private / "workspace"
        workspace.mkdir()
        seed_env = self.environment(self.private / "seed-home", base)
        self.command(["git", "init", "--quiet", "--initial-branch=main", str(workspace)], "fixture-git", env=seed_env)
        self.command(["git", "-C", str(workspace), "-c", "user.name=Disposable NAC performance fixture",
            "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit",
            "--quiet", "--allow-empty", "-m", "fixture baseline"], "fixture-commit", env=seed_env)
        seed = self.private / "seed.db"
        backend, endpoint = self.launch_backend(engine, workspace, seed, seed_env, "seed-backend")
        config = self.api(endpoint, "model-configs", {"name": "Dummy performance calibration", "backend": "openai-responses",
            "model": "gpt-5.6-sol", "base_url": base, "api_key": "performance-dummy-only", "reasoning_effort": "high",
            "extra_headers": {}, "orchestrator_compaction_threshold": 0})
        project_label = "MAC PERF CALIBRATION"
        project = self.api(endpoint, "projects", {"name": project_label, "cwd": str(workspace),
            "default_model_config_id": config["config_id"]})
        self.api(endpoint, "sessions", {"behavior": "direct", "project_id": project["project_id"]})
        backend.stop()
        self.owned.remove(backend)
        if Path(str(seed) + "-wal").exists() and Path(str(seed) + "-wal").stat().st_size:
            raise ValueError("Seed WAL not drained; refusing incomplete database clone")
        self.report["closed_seed_sha256"] = digest(seed)
        self.report["seed_scope"] = "One empty direct session for calibration, NOT the64turn transcript measurement"
        stores = {}
        for arm in ("native", "browser"):
            stores[arm] = self.private / (arm + ".db")
            shutil.copy2(seed, stores[arm])
        self.report["seed_copies_identical"] = all(digest(p) == digest(seed) for p in stores.values())
        return provider, workspace, base, project_label, stores

    def run(self):
        engine, app, project = self.build()
        provider, workspace, base, label, stores = self.fixture(engine)
        browser_env = self.environment(self.private / "browser-home", base)
        browser_backend, browser_url = self.launch_backend(engine, workspace, stores["browser"], browser_env, "browser-backend")
        safari = Path("/Applications/Safari.app")
        with (safari / "Contents/Info.plist").open("rb") as stream:
            safari_executable = plistlib.load(stream)["CFBundleExecutable"]
        ui = self.private / "ui-calibration.json"
        config = {"schema": "nac-mac-performance-driver-v1", "output": str(ui),
            "requested_input_characters": 100, "input_batch_characters": 1,
            "deadline_uptime_ns": 0, "arms": [
                {"name": "native", "app_path": str(app), "native_sha256": digest(app / "Contents/MacOS/NACPreview"),
                 "arguments": ["--directory", str(workspace), "--store-path", str(stores["native"])],
                 "environment": self.environment(self.private / "native-home", base), "project_label": label, "url": None},
                {"name": "browser", "app_path": str(safari), "native_sha256": digest(safari / "Contents/MacOS" / safari_executable),
                 "arguments": [], "environment": {}, "project_label": label, "url": browser_url + "/#/"}]}
        config_path = self.private / "driver-config.json"
        write_json(config_path, config)
        self.command(["xcodebuild", "build-for-testing", "-project", str(project), "-scheme", "NACNativeUITests",
            "-destination", "platform=macOS,arch=arm64", "-derivedDataPath", str(self.private / "driver"),
            "-parallel-testing-enabled", "NO", "NAC_UI_FIXTURE=" + str(config_path),
            "NAC_PERFORMANCE_SOURCE=" + str(HERE / "PerformanceJourneys.swift")], "driver-build", limit=180)
        runners = list((self.private / "driver/Build/Products").glob("*.xctestrun"))
        if len(runners) != 1:
            raise ValueError("Xcode must generate one actual runner")
        self.report["generated_runner_sha256"] = digest(runners[0])
        sys.path.insert(0, str(self.args.harness_root / "desktop/macos"))
        from ci_xctest import require_generated_runner
        generated = plistlib.loads(runners[0].read_bytes())
        generated_target = require_generated_runner(generated, config_path)
        self.report["generated_runner_observer_configuration"] = {
            "target_antipattern_checker": generated_target.get("UITargetAppPerformanceAntipatternCheckerEnabled"),
            "testing_environment": {k: v for k, v in generated_target.get("TestingEnvironmentVariables", {}).items()
                                    if k.startswith(("DYLD_", "PERFC_"))},
            "target_environment": {k: v for k, v in generated_target.get("UITargetAppEnvironmentVariables", {}).items()
                                   if k.startswith(("DYLD_", "PERFC_"))}}
        initial_policy = self.observe_policy()
        write_json(self.private / "authorization-before.json", initial_policy)
        self.phase("calibration_and_process_attribution")
        self.report["cpu_unit_control"] = self.cpu_control()
        config["deadline_uptime_ns"] = int(self.phase_deadline * 1_000_000_000)
        config_path.write_text(json.dumps(config))
        sampler = Sampler(self.private / "process-usage", self.private / "processes.jsonl", ui, self)
        self.sampler = sampler
        sampler.add(provider.process.pid, "provider", provider.sampling_receipt())
        sampler.add(browser_backend.process.pid, "backend", browser_backend.sampling_receipt())
        sampler.add(os.getpid(), "observer", {"kind": "current_process", "pid": os.getpid(),
                                              "executable": str(Path(sys.executable).resolve())})
        sampler.thread.start()
        try:
            self.command(["xcodebuild", "test-without-building", "-xctestrun", str(runners[0]),
                "-destination", "platform=macOS,arch=arm64", "-parallel-testing-enabled", "NO",
                "-maximum-concurrent-test-device-destinations", "1",
                "-only-testing:NACNativeUITests/PerformanceJourneys/testCalibration",
                "-resultBundlePath", str(self.private / "calibration.xcresult")], "driver-calibration", limit=240)
            raw = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path",
                str(self.private / "calibration.xcresult")], capture_output=True, timeout=min(15, self.remaining()), check=True).stdout
            if len(raw) > 128_000:
                raise ValueError("Actual XCTest summary exceeds cap")
            summary = json.loads(raw)
            require_calibration_result(summary)
            self.report["xctest_summary"] = {key: summary[key] for key in
                ("totalTestCount", "passedTests", "failedTests", "skippedTests", "result")}
        finally:
            sampler.close()
            self.report["sampler_error"] = sampler.error
            final_policy = self.observe_policy()
            write_json(self.private / "authorization-after.json", final_policy)
            self.report["persistent_authorization_policy_unchanged"] = initial_policy == final_policy
            if initial_policy != final_policy:
                raise ValueError("Persistent authorization policy changed; qualification stopped")
        self.report["driver"] = read_json(ui)
        self.report["calibration_controls"] = {"browser_backend_prestarted": True,
            "not_a_comparative_trial": True, "cpu_unit_validation": self.report["cpu_unit_control"]["status"],
            "xctest_runtime_instrumentation": "generated configuration retained; actual loaded libraries and paired overhead controls unverified",
            "helper_attribution": "incomplete; PPID does not identify reparented XPC helpers"}
        self.report.update(signal_completeness(self.contract, {}))
        self.report["result"] = "CALIBRATION_ONLY_REQUIRED_MEASUREMENTS_INCOMPLETE"
        self.checkout(self.args.source_root, self.args.target_sha)
        self.checkout(self.args.harness_root, self.args.harness_sha)
        self.checkout(HERE.parents[2], self.args.tools_sha)

    def close(self):
        for item in reversed(self.owned):
            try:
                item.stop()
                self.report["cleanup"].append({"created_pid": item.process.pid, "reaped": True})
            except BaseException as error:
                self.report["cleanup"].append({"created_pid": item.process.pid, "reaped": False,
                                               "error_type": type(error).__name__})
        # Observe recorded incarnations only. Do not add PID-based signaling of
        # LaunchServices apps after a test failure: we don't retain their child
        # handle. Swift's exact XCUIApplication owner performs normal shutdown.
        verified = False
        if self.sampler is not None:
            pending = {pid: entry for pid, entry in self.sampler.roots.items()
                       if entry["role"] not in ("observer", "provider")}
            end = min(self.deadline, time.monotonic() + 30)
            while pending and time.monotonic() < end:
                for pid, entry in list(pending.items()):
                    if time.monotonic() >= end:
                        break
                    row = self.sampler.sample(pid, entry)
                    if row.get("owned_incarnation_dead") or row.get("status") == "unavailable" and row.get("errno") == 3:
                        pending.pop(pid)
                if pending:
                    time.sleep(.1)
            verified = bool(self.sampler.roots) and not pending
            self.report["cleanup_unresolved_recorded_pids"] = list(pending)
        self.report["recorded_process_cleanup_verified"] = verified
        self.report["whole_process_set_cleanup_verified"] = False
        self.report["cleanup_scope"] = "Missing XPC attribution or missing PID receipts remains unknown; failed profiles retained"

    def export(self):
        self.args.output.mkdir(mode=0o700)
        replacements = [(str(self.private), "<private-fixture>"), (str(self.args.source_root), "<target>"),
                        (str(self.args.harness_root), "<harness>"), (str(HERE.parents[2]), "<tools>")]
        total = 0
        index = {}
        for file in sorted(self.private.iterdir()):
            if file.is_symlink() or not file.is_file() or file.suffix not in (".json", ".jsonl", ".log"):
                continue
            size = file.stat().st_size
            if size > 10 * 1024 * 1024 or total + size > MAX_EXPORT_BYTES:
                self.report.setdefault("export_omissions", []).append(file.name)
                continue
            text = file.read_text(errors="replace")
            for old, new in replacements:
                text = text.replace(old, new)
            target = self.args.output / file.name
            target.write_text(text)
            total += size
            index[file.name] = digest(target)
        encoded = json.dumps(self.report, indent=2, allow_nan=False)
        for old, new in replacements:
            encoded = encoded.replace(old, new)
        (self.args.output / "attempt.json").write_text(encoded + "\n")
        index["attempt.json"] = digest(self.args.output / "attempt.json")
        write_json(self.args.output / "evidence-index.json", index)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=HERE / "allocation-v2.json")
    parser.add_argument("--calibrate", action="store_true", help="Requires separate exact nomination/dispatch approval")
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--harness-root", type=Path)
    parser.add_argument("--target-sha")
    parser.add_argument("--harness-sha")
    parser.add_argument("--tools-sha")
    parser.add_argument("--dispatch-reference")
    parser.add_argument("--epoch", type=Path, help="First job-step monotonic start JSON")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        return execute(args)
    except Exception as error:
        # Admission refusal is evidence too. It launches no command and never
        # overwrites another attempt's destination.
        if not args.output.exists() and not args.output.is_symlink():
            args.output.mkdir(mode=0o700)
            write_json(args.output / "attempt.json", {"schema": "nac-mac-performance-attempt-v1",
                "result": "ADMISSION_REFUSED", "operation": "validate_contract_and_nomination",
                "error_type": type(error).__name__, "reason": str(error)[:600],
                "measurement_ready": False, "nac_performance_trials": 0,
                "numerical_product_budgets": None})
        return 2


def execute(args):
    contract = read_json(args.contract)
    validate_contract(contract, read_json(HERE / "workloads.json"))
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("Evidence destination must be new")
    if not args.calibrate:
        args.output.mkdir(mode=0o700)
        write_json(args.output / "contract-validation.json", {"result": "CONTRACT_ONLY",
            "core_cap_seconds": contract["core_cap_seconds"], "nac_performance_trials": 0,
            "dispatch_approved": False, "known_unavailable": contract["known_unavailable"]})
        return 0
    require_approval(contract, args.target_sha, args.harness_sha, args.dispatch_reference)
    if os.uname().sysname != "Darwin" or os.uname().machine != "arm64" or not args.epoch:
        raise ValueError("Actual allocated ARM Mac and first-step epoch required")
    if not args.source_root or not args.harness_root or not SHA.fullmatch(args.tools_sha or ""):
        raise ValueError("Exact separate source/harness/tools checkouts required")
    args.source_root, args.harness_root = args.source_root.resolve(), args.harness_root.resolve()
    if (args.source_root == args.harness_root or args.source_root.is_relative_to(args.harness_root)
            or args.harness_root.is_relative_to(args.source_root)):
        raise ValueError("Target must be separate from harness")
    epoch = read_json(args.epoch)["monotonic_ns"] / 1_000_000_000
    if not math.isfinite(epoch) or not 0 <= time.monotonic() - epoch < contract["core_cap_seconds"]:
        raise ValueError("Expired or invalid job epoch")
    calibration = Calibration(args, contract, epoch)
    try:
        calibration.run()
    except BaseException as error:
        calibration.report.update(result="PREREQUISITE_OR_CALIBRATION_FAILED", error_type=type(error).__name__,
                                  error=str(error)[:600], measurement_ready=False)
    finally:
        calibration.close()
        calibration.export()
    return 2  # Calibration observations never certify the required matched measurement.


if __name__ == "__main__":
    raise SystemExit(main())
