#!/usr/bin/env python3
"""Bounded dummy-only Responses provider for the ALL-353 workload manifest."""

import argparse
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import signal
import threading
import time


WORKLOAD_PATH = Path(__file__).with_name("workloads.json")
WORKLOAD = json.loads(WORKLOAD_PATH.read_bytes())
MODEL = "gpt-5.6-sol"


def trial_plan(contract):
    """Closed workload matrix, including diagnostic observer-off pairs.

    A pair is never retried or replaced. First useful workspace is an endpoint
    of each launch trial, rather than a second launch with a different cache.
    Cold boot, consumer close/reopen and notifications have separate gates.
    """
    if contract["paired_blocks"] != 20 or contract["idle_seconds"] != 30:
        raise ValueError("Finite plan requires the allocated20 pairs and30s idle")
    rows = []
    for cell in WORKLOAD["finite_cells"]:
        for observer, count in (("on", 20), ("off", 1)):
            for pair in range(count):
                arms = ("native", "browser") if pair % 2 == 0 else ("browser", "native")
                for position, arm in enumerate(arms):
                    rows.append({**cell, "trial": len(rows), "pair": pair, "arm": arm,
                        "position": position, "observer": observer,
                        "control_only": observer == "off", "session_behavior": "direct",
                        "session_count": 8 if cell["seed"] == "empty_8" else 1,
                        "ptys_per_session": 1, "columns": 120, "rows": 36,
                        "settle_seconds": contract["settlement_seconds"],
                        "trusted_events_per_surface": 100 if cell["input"] else 0,
                        "requested_css_viewport": contract["proposed_css_viewport"]})
    return rows


class TrialLedger:
    """Retain every attempted/censored arm; execution is distinct from evidence."""

    def __init__(self, plan, identity, retain, clock=time.monotonic_ns):
        self.plan, self.identity, self.retain, self.clock = copy.deepcopy(plan), identity, retain, clock
        self.rows = []

    def finish(self, row, status, started, deadline, receipt=None, reason=None):
        if row != self.plan[len(self.rows)] or status not in ("executed", "failed", "censored"):
            raise ValueError("Out-of-order, duplicate or invalid finite trial")
        value = {**row, "schema": "nac-mac-trial-v1", "identity": self.identity,
            "status": status, "started_monotonic_ns": started, "ended_monotonic_ns": self.clock(),
            "deadline_monotonic_ns": deadline, "clock": "python.monotonic_ns",
            "receipt": receipt, "reason": reason, "qualified": False}
        # Transport/execution success does not attest missing process/frame/input
        # observations or zero loss. Qualification is a separate evidence step.
        self.retain(value)
        self.rows.append(value)

    def summary(self):
        cells = {}
        for cell in {row["cell"] for row in self.plan}:
            group = [row for row in self.rows if row["cell"] == cell and not row["control_only"]]
            pairs = {p: [r for r in group if r["pair"] == p] for p in range(20)}
            cells[cell] = {"planned_pairs": 20, "recorded_arms": len(group),
                "executed_pairs": sum(len(rs) == 2 and all(r["status"] == "executed" for r in rs)
                                      for rs in pairs.values()), "qualified_pairs": 0,
                "observer_off_arms": sum(r["cell"] == cell and r["control_only"] for r in self.rows)}
        return {"planned_arms": len(self.plan), "recorded_arms": len(self.rows), "cells": cells,
            "measurement_ready": False, "performance_distributions": None}


class FiniteController:
    """Synchronous finite dispatch with cumulative phase/core deadlines.

    The actual runner supplies prepare/drive/cleanup as one owned trial call;
    tests supply a fake. No thread, process, UI input or API call starts here.
    """

    def __init__(self, contract, identity, retain, epoch_ns, clock=time.monotonic_ns):
        self.contract, self.clock, self.epoch = contract, clock, epoch_ns
        self.ledger = TrialLedger(trial_plan(contract), identity, retain, clock)

    def run(self, execute):
        caps = {p["name"]: p["cap_seconds"] * 1_000_000_000 for p in self.contract["phases"]}
        core_end = (self.epoch + self.contract["core_cap_seconds"] * 1_000_000_000
                    - caps["cleanup_and_evidence_export"] - caps["summary_and_final_receipts"])
        phase, end, abort = None, None, None
        for row in self.ledger.plan:
            if row["phase"] != phase:
                phase = row["phase"]
                end = min(core_end, self.clock() + caps[phase])
            start = self.clock()
            if abort or start >= end:
                self.ledger.finish(row, "censored", start, end, reason=abort or "phase_or_core_deadline")
                continue
            self.ledger.retain({"schema": "nac-mac-trial-start-v1", **row, "identity": self.ledger.identity,
                "started_monotonic_ns": start, "deadline_monotonic_ns": end})
            try:
                receipt = execute(copy.deepcopy(row), end)
                if self.clock() >= end:
                    raise TimeoutError("Trial returned after phase/core deadline")
                if not isinstance(receipt, dict) or receipt.get("execution_complete") is not True:
                    raise ValueError("Actual trial completion receipt missing")
                self.ledger.finish(row, "executed", start, end, receipt=receipt)
            except Exception as error:
                self.ledger.finish(row, "failed", start, end,
                    reason=type(error).__name__ + ": " + str(error)[:300])
                # Ownership, loss and fixture failures cannot silently affect
                # subsequent arms. Retain the entire unexecuted tail as censored.
                abort = "stopped_after_trial_failure"
        return self.ledger.summary()


class ClosedSeeds:
    """Create ordinary API stores, shut down their writer, then clone bytes.

    The controller owns the engine command/environment. No SQLite writes or
    invented persistence shapes bypass the application APIs.
    """

    def __init__(self, runner, engine, workspace, provider):
        self.runner, self.engine, self.workspace, self.provider = runner, engine, workspace, provider

    def build(self):
        r, seeds = self.runner, {}
        for name, count, turns in (("empty_1", 1, 0), ("empty_8", 8, 0), ("transcript_1", 1, 64)):
            store = r.private / (name + ".db")
            env = r.environment(r.private / (name + "-home"), self.provider)
            backend, endpoint = r.launch_backend(self.engine, self.workspace, store, env, "seed-" + name)
            try:
                model = r.api(endpoint, "model-configs", {"name": "Dummy finite workload", "backend": "openai-responses",
                    "model": MODEL, "base_url": self.provider, "api_key": "performance-dummy-only",
                    "reasoning_effort": "high", "extra_headers": {}, "orchestrator_compaction_threshold": 0})
                project = r.api(endpoint, "projects", {"name": "MAC PERF FIXTURE", "cwd": str(self.workspace),
                    "default_model_config_id": model["config_id"]})
                sessions = []
                for index in range(count):
                    session = r.api(endpoint, "sessions", {"behavior": "direct", "project_id": project["project_id"]})
                    sid = session["metadata"]["session_id"]
                    title = f"MAC PERF SESSION {index + 1:02d}"
                    r.api(endpoint, f"sessions/{sid}/presentation", {"title": title, "pinned": False,
                        "expected_version": 0}, method="PUT")
                    sessions.append({"id": sid, "title": title})
                if len({s["id"] for s in sessions}) != count:
                    raise ValueError("Fixture API returned duplicate session identities")
                for index in range(turns):
                    expected = transcript(index)
                    r.api(endpoint, f"sessions/{sessions[0]['id']}/runs", {"prompt": expected["user"]})
                    turn_end = time.monotonic() + 30
                    while True:
                        r.remaining()
                        if time.monotonic() >= turn_end:
                            raise TimeoutError("Exact completed transcript turn unavailable")
                        state = r.api(endpoint, f"sessions/{sessions[0]['id']}", None)
                        if state.get("run_failure"):
                            raise ValueError("Transcript seed run failed")
                        # Looking for the exact completed assistant text avoids
                        # accepting a transient idle state before run admission.
                        text = json.dumps(state.get("messages", []), ensure_ascii=False)
                        if state.get("active_run") is None and expected["assistant"] in _message_texts(state):
                            break
                        if len(text) > 1_500_000:
                            raise ValueError("Transcript snapshot exceeded seed cap")
                        time.sleep(.05)
            finally:
                backend.stop()
                r.owned.remove(backend)
            wal = Path(str(store) + "-wal")
            if wal.exists() and wal.stat().st_size:
                raise ValueError("Closed fixture WAL not drained")
            seeds[name] = {"path": store, "sha256": hashlib.sha256(store.read_bytes()).hexdigest(),
                "sessions": sessions, "turns": turns, "project_label": "MAC PERF FIXTURE"}
        return seeds

    @staticmethod
    def clone(seed, destination):
        import shutil
        source = seed["path"]
        if destination.exists() or destination.is_symlink():
            raise ValueError("Refusing to reuse an open/warm trial store")
        if hashlib.sha256(source.read_bytes()).hexdigest() != seed["sha256"]:
            raise ValueError("Closed seed changed")
        with destination.open("xb") as output, source.open("rb") as original:
            shutil.copyfileobj(original, output)
        if hashlib.sha256(destination.read_bytes()).hexdigest() != seed["sha256"]:
            raise ValueError("Paired fixture clone differs")

    @staticmethod
    def open_ptys(runner, owned_endpoint, sessions):
        """Existing version1 human terminal admission; no input or ACK bypass.

        Browser endpoints come from the retained owned backend handle. Calling
        this for native requires the missing independent native engine receipt,
        never port scanning, a fixed listener or an invented endpoint.
        """
        import uuid
        terminals = []
        for session in sessions:
            result = runner.api(owned_endpoint, f"sessions/{session['id']}/user-terminals",
                {"protocol_version": 1, "launch_id": str(uuid.uuid4()), "cols": 120, "rows": 36})
            if (result.get("protocol_version") != 1 or result.get("alive") is not True
                    or (result.get("cols"), result.get("rows")) != (120, 36)
                    or not isinstance(result.get("terminal_id"), str) or not result["terminal_id"]):
                raise ValueError("Actual terminal admission/dimensions not confirmed")
            terminals.append({"session_id": session["id"], **result})
        if len({t["terminal_id"] for t in terminals}) != len(sessions):
            raise ValueError("Duplicate PTY identity across fixture sessions")
        return terminals


def _message_texts(state):
    # Message is a serde-tagged enum; text content blocks retain their actual
    # text field. Traverse only the bounded snapshot messages, never logs.
    def texts(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "content" and value.get("role") == "assistant" and isinstance(item, str):
                    yield item
                else:
                    yield from texts(item)
        elif isinstance(value, list):
            for item in value:
                yield from texts(item)
    return list(texts(state.get("messages", [])))


class FixtureWorkloads:
    """Actual finite fixture/driver adapter. run.py owns admission and commands.

    This source can be unit-tested without a Mac. It must not be dispatched
    until the missing native receipts/observers and exact H integration exist.
    Every arm gets a new closed-seed clone and an isolated profile. A warm
    launch is primed then relaunched by the same retained UI controller.
    """

    def __init__(self, runner):
        self.r = runner

    def run(self):
        import run as support
        import sys
        r = self.r
        r.report["scope"] = "finite source-defined attempts; required raw evidence remains unqualified"
        self.engine, self.app, project = r.build()
        self.provider, self.workspace, self.base = r.fixture_support("suite")
        self.seeds = ClosedSeeds(r, self.engine, self.workspace, self.base).build()
        r.report["closed_seeds"] = {name: {k: v for k, v in seed.items() if k != "path"}
                                     for name, seed in self.seeds.items()}
        self.config_path = r.private / "finite-driver.json"
        support.write_json(self.config_path, {"schema": "not-yet-dispatchable"})
        r.command(["xcodebuild", "build-for-testing", "-project", str(project), "-scheme", "NACNativeUITests",
            "-destination", "platform=macOS,arch=arm64", "-derivedDataPath", str(r.private / "finite-driver"),
            "-parallel-testing-enabled", "NO", "NAC_UI_FIXTURE=" + str(self.config_path),
            "NAC_PERFORMANCE_SOURCE=" + str(support.HERE / "PerformanceJourneys.swift")], "finite-driver-build", limit=180)
        runners = list((r.private / "finite-driver/Build/Products").glob("*.xctestrun"))
        if len(runners) != 1:
            raise ValueError("Exact H must produce one generated XCTest runner")
        self.xctestrun = runners[0]
        import plistlib
        sys.path.insert(0, str(r.args.harness_root / "desktop/macos"))
        from ci_xctest import require_generated_runner
        generated = plistlib.loads(self.xctestrun.read_bytes())
        require_generated_runner(generated, self.config_path)
        r.report["finite_generated_runner_sha256"] = support.digest(self.xctestrun)
        r.phase("calibration_and_process_attribution")
        self.policy = r.observe_policy()
        support.write_json(r.private / "finite-policy-before.json", self.policy)
        r.report["cpu_unit_control"] = r.cpu_control()
        identity = {"target_sha": r.args.target_sha, "harness_sha": r.args.harness_sha,
            "tools_sha": r.args.tools_sha, "engine_sha256": support.digest(self.engine),
            "assets": r.report["embedded_asset_tree"], "workloads_sha256": r.report["workloads_sha256"]}
        with (r.private / "trials.jsonl").open("x") as stream:
            def retain(row):
                stream.write(json.dumps(row, sort_keys=True, allow_nan=False) + "\n")
                stream.flush()
            controller = FiniteController(r.contract, identity, retain, int(r.start * 1_000_000_000))
            r.report["finite_accounting"] = controller.run(self.execute)
        after = r.observe_policy()
        support.write_json(r.private / "finite-policy-after.json", after)
        if self.policy != after:
            raise ValueError("Persistent authorization policy changed")
        r.checkout(r.args.source_root, r.args.target_sha)
        r.checkout(r.args.harness_root, r.args.harness_sha)
        r.checkout(support.HERE.parents[2], r.args.tools_sha)
        r.report.update(result="FINITE_ATTEMPTS_RETAINED_EVIDENCE_UNQUALIFIED", measurement_ready=False)

    def execute(self, row, deadline):
        import plistlib
        import shlex
        import sys
        import subprocess
        import run as support
        r = self.r
        r.phase_deadline = deadline / 1_000_000_000
        r.remaining()
        folder = r.private / f"trial-{row['trial']:04d}"
        folder.mkdir(mode=0o700)
        seed = self.seeds[row["seed"]]
        store = folder / "store.db"
        ClosedSeeds.clone(seed, store)
        env = r.environment(folder / "home", self.base)
        backend, sampler = None, None
        app = self.app if row["arm"] == "native" else Path("/Applications/Safari.app")
        with (app / "Contents/Info.plist").open("rb") as info:
            executable = app / "Contents/MacOS" / plistlib.load(info)["CFBundleExecutable"]
        arm = {"name": row["arm"], "app_path": str(app), "native_sha256": support.digest(executable),
            "arguments": ["--directory", str(self.workspace), "--store-path", str(store)] if row["arm"] == "native" else [],
            "environment": env if row["arm"] == "native" else {}, "project_label": seed["project_label"], "url": None}
        ui = folder / "ui.json"
        producer = folder / "terminal-producer.jsonl"
        config = {"schema": "nac-mac-finite-driver-v1", "output": str(ui), "requested_input_characters": 100,
            "input_batch_characters": 1, "deadline_uptime_ns": deadline, "arms": [arm],
            "trial": {**row, "session_titles": [s["title"] for s in seed["sessions"]],
                "preopened_ptys": False,
                "terminal_command": shlex.join([sys.executable, "-B", str(support.HERE / "terminal.py"),
                    "--evidence", str(producer)])}}
        try:
            if row["arm"] == "browser":
                backend, endpoint = r.launch_backend(self.engine, self.workspace, store, env, f"trial-{row['trial']:04d}-backend")
                arm["url"] = endpoint + "/#/"
                terminals = ClosedSeeds.open_ptys(r, endpoint, seed["sessions"])
                config["trial"]["preopened_ptys"] = True
                support.write_json(folder / "terminal-admission.json", terminals)
            if row["observer"] == "on":
                # Available raw process observer only. No invented queue,
                # frame or input hooks; full admission remains closed on them.
                sampler = support.Sampler(r.private / "process-usage", folder / "processes.jsonl", ui, r)
                sampler.add(self.provider.process.pid, "provider", self.provider.sampling_receipt())
                if backend is not None:
                    sampler.add(backend.process.pid, "backend", backend.sampling_receipt())
                import os
                sampler.add(os.getpid(), "observer", {"kind": "current_process", "pid": os.getpid(),
                    "executable": str(Path(sys.executable).resolve())})
                r.sampler = sampler
                sampler.thread.start()
            # Atomic replacement of a private dispatch file; driver output and
            # each result bundle remain exclusive, never reused between arms.
            temporary = self.config_path.with_suffix(".next")
            support.write_json(temporary, config)
            temporary.replace(self.config_path)
            result = folder / "trial.xcresult"
            r.command(["xcodebuild", "test-without-building", "-xctestrun", str(self.xctestrun),
                "-destination", "platform=macOS,arch=arm64", "-parallel-testing-enabled", "NO",
                "-maximum-concurrent-test-device-destinations", "1",
                "-only-testing:NACNativeUITests/PerformanceJourneys/testFiniteTrial",
                "-resultBundlePath", str(result)], f"finite-trial-{row['trial']:04d}", limit=r.remaining())
            summary = subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result)],
                capture_output=True, check=True, timeout=min(15, r.remaining())).stdout
            if len(summary) > 128_000:
                raise ValueError("Unbounded XCTest summary")
            support.require_calibration_result(json.loads(summary))
            receipt = support.read_json(ui)
            completed = [e for e in receipt["observations"] if e["event"] == "finite_trial_completed"]
            if len(completed) != 1 or completed[0].get("trial") != row["trial"]:
                raise ValueError("Missing/mismatched actual finite driver completion")
            cleanup = [e for e in receipt["observations"] if e["event"] == "app_cleanup"]
            if len(cleanup) != (2 if row["action"] == "warm_launch" else 1) or any(e.get("app_stopped") is not True for e in cleanup):
                raise ValueError("Exact owned app cleanup receipt missing/failed")
            if row["action"] == "terminal":
                # UI command scheduling and producer completion are separate.
                # Wait only within the existing phase cap for the600th receipt.
                producer_end = time.monotonic() + min(3, r.remaining())
                while time.monotonic() < producer_end:
                    r.remaining()
                    if producer.exists() and len(producer.read_text().splitlines()) == 600:
                        break
                    time.sleep(.05)
                verify_terminal_producer(producer)
            if sampler is not None:
                sampler.close()
                if sampler.error:
                    raise ValueError("Process observer failed")
            return {"execution_complete": True, "ui_sha256": support.digest(ui),
                "seed_sha256": seed["sha256"], "closed_seed_clone_verified": True,
                "raw_signal_coverage_complete": False, "loss": None,
                "observations": "unqualified; actual raw observations and clock mapping remain required"}
        finally:
            if sampler is not None:
                sampler.close()
            if backend is not None:
                backend.stop()
                r.owned.remove(backend)


def verify_terminal_producer(path):
    """Producer bytes/pace accounting; never renderer or PTY attribution proof."""
    spec = WORKLOAD["terminal"]
    count = spec["duration_seconds"] * spec["batches_per_second"]
    size = spec["lines_per_batch"] * spec["line_ascii_bytes_including_lf"]
    if path.is_symlink() or path.stat().st_size > 2_000_000:
        raise ValueError("Invalid terminal producer receipt")
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    if len(rows) != count:
        raise ValueError("Terminal producer incomplete")
    for index, row in enumerate(rows):
        if (row.get("schema") != "nac-mac-perf-terminal-v1" or row.get("batch") != index
                or row.get("source_bytes") != size or row.get("total_source_bytes") != (index + 1) * size
                or type(row.get("scheduled_ns")) is not int or type(row.get("written_ns")) is not int
                or row["written_ns"] < row["scheduled_ns"]
                or row["scheduled_ns"] != rows[0]["scheduled_ns"] + index * 1_000_000_000 // spec["batches_per_second"]):
            raise ValueError("Terminal producer partial, reordered or invalid")
    return {"batches": count, "source_bytes": count * size, "rendered_bytes": None}


def transcript(index):
    spec = WORKLOAD["transcript"]
    return {
        "user": spec["user_template"].format(index=index),
        "assistant": spec["assistant_template"].replace("{index:03d}", f"{index:03d}").replace("{index}", str(index))
        * spec["assistant_repeats_per_turn"],
    }


def stream_parts():
    spec = WORKLOAD["stream"]
    return [spec["delta_template"].format(index=i) for i in range(spec["deltas"])] + [spec["tail"]]


class Fixture(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, mode, evidence):
        super().__init__(("127.0.0.1", 0), Handler)
        self.mode = mode
        self.evidence = evidence
        self.sequence = 0
        self.busy = threading.Lock()
        self.log_lock = threading.Lock()

    def record(self, event, **fields):
        with self.log_lock:
            self.evidence.write(json.dumps({"schema": "nac-mac-perf-provider-v1",
                "monotonic_ns": time.monotonic_ns(), "event": event, **fields}, sort_keys=True) + "\n")
            self.evidence.flush()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass  # No bodies, arbitrary headers or local paths in fixture evidence.

    def do_GET(self):
        if self.path.startswith("/models-dev"):
            self.send_response(304)
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
        elif self.path == "/models":
            self.json_reply({"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "local-fixture"}]})
        else:
            self.send_error(404)

    def json_reply(self, value):
        body = json.dumps(value, sort_keys=True).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_POST(self):
        if self.path != "/responses":
            self.send_error(404)
            return
        if not self.server.busy.acquire(blocking=False):
            self.send_error(409, "One fixture response at a time")
            return
        try:
            self.connection.settimeout(10)
            try:
                size = int(self.headers.get("Content-Length", "-1"))
                if self.headers.get("Transfer-Encoding") or not 0 < size <= 8_388_608:
                    raise ValueError("unsupported body")
                request = json.loads(self.rfile.read(size))
                if not isinstance(request, dict) or request.get("model") != MODEL:
                    raise ValueError("unsupported model")
            except (ValueError, OSError):
                self.send_error(400, "Expected bounded JSON Responses request")
                return
            index = self.server.sequence
            transcript_turns = WORKLOAD["transcript"]["turns"]
            maximum = {"transcript": transcript_turns, "stream": 1,
                       "suite": transcript_turns + 42}[self.server.mode]
            if index >= maximum:
                self.server.record("rejected_extra_request", request_index=index)
                self.send_error(409, "Fixture plan exhausted; no replay")
                return
            is_transcript = self.server.mode == "transcript" or self.server.mode == "suite" and index < transcript_turns
            expected = transcript(index)["user"] if is_transcript else "MAC_PERF_V1_STREAM"
            if expected not in json.dumps(request):
                self.server.record("rejected_wrong_prompt", request_index=index)
                self.send_error(409, "Expected next fixture prompt")
                return
            self.server.sequence += 1
            parts = [transcript(index)["assistant"]] if is_transcript else stream_parts()
            text = "".join(parts)
            self.server.record("request", request_index=index, request_bytes=size,
                               output_bytes=len(text.encode()), streaming=request.get("stream") is True)
            item = {"id": f"msg-perf-{index}", "type": "message", "status": "completed",
                    "role": "assistant", "content": [{"type": "output_text", "text": text, "annotations": []}]}
            response = {"id": f"resp-perf-{index}", "object": "response", "status": "completed",
                        "model": MODEL, "output": [item],
                        "usage": {"input_tokens": 7, "output_tokens": 9, "total_tokens": 16}}
            if request.get("stream") is not True:
                self.json_reply(response)
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                start = time.monotonic_ns()
                interval = 0 if is_transcript else WORKLOAD["stream"]["interval_ms"] * 1_000_000
                for delta_index, part in enumerate(parts):
                    scheduled = start + delta_index * interval
                    delay = (scheduled - time.monotonic_ns()) / 1_000_000_000
                    if delay > 0:
                        time.sleep(delay)
                    self.event({"type": "response.output_text.delta", "delta": part})
                    self.server.record("delta_flushed", request_index=index, delta_index=delta_index,
                                       scheduled_ns=scheduled, text_bytes=len(part.encode()))
                self.event({"type": "response.output_item.done", "output_index": 0, "item": item})
                self.event({"type": "response.completed", "response": response})
                self.close_connection = True
            self.server.record("completed", request_index=index)
        except (OSError, TimeoutError) as error:
            self.server.record("delivery_failed", error_type=type(error).__name__)
            self.close_connection = True
        finally:
            self.server.busy.release()

    def event(self, value):
        self.wfile.write(b"data: " + json.dumps(value, sort_keys=True).encode() + b"\n\n")
        self.wfile.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["transcript", "stream", "suite"], required=True)
    parser.add_argument("--evidence", type=Path, required=True, help="New provider-only JSONL (not a measurement report)")
    args = parser.parse_args()
    def terminate(*_):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, terminate)
    with args.evidence.open("x") as evidence:
        with Fixture(args.mode, evidence) as server:
            server.record("start", mode=args.mode,
                          workloads_sha256=hashlib.sha256(WORKLOAD_PATH.read_bytes()).hexdigest())
            print(json.dumps({"base_url": f"http://127.0.0.1:{server.server_port}",
                              "mode": args.mode}), flush=True)
            try:
                server.serve_forever(poll_interval=0.1)
            finally:
                server.record("stop", consumed=server.sequence)


if __name__ == "__main__":
    main()
