#!/usr/bin/env python3
"""One bounded candidate episode; P proof and L qualification stay separate."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time
import traceback
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
L = "1e873aa5200571940fe27dedb9c80b8f19966ebf"
P = "cf0d83ac1a57e73ed7915ea211d2b39cfc2aad17"
TREES = {"L": "0056e2b616fd969108211e1fe3f93768e7c876f2", "P": "8abd8956c22fedbb709659892a1cba0f80b6b153"}
L_HASHES = {
    "crates/nac-core/src/session_service/direct_interaction/owned_lifecycle_tests.rs": "f3a28282f11e20e4ee1be4c9691a8ca373ea528cfb5b4bb990c7009872034600",
    "crates/nac-server/src/application/attention_semantic_tests.rs": "6b19390423f0fa2c29c57b5682cbf1485461d75d92c8999290d29b25a3f665de",
}
P_HASHES = dict(L_HASHES, **{
    "crates/nac-core/src/session_service/attention_continuation_tests.rs": "5d8170cafb5d98d00f86301478066ec22bb504cb64d33a01523f96d2fe4d1a2d",
    "crates/nac-core/src/session_service/attention_test_support/continuation.rs": "3d7682b0ad0f428c7dfac874e4cc56528a9e4898595b9b9dd0ee66d1b67f6e57",
    "crates/nac-core/src/session_service/direct_interaction.rs": "caceddfabfac0e50a6023e554b0bbaabe8a160e1b093b6dc209409a281b3595e",
})
GREEN = "session_service::attention::tests::continuation::fenced_original_settlement_caller_cannot_recreate_store_after_typed_drain"
CORE_GROUPS = {
    "session_service::direct_interaction::owned_lifecycle_tests::": [
        "idle_direct_wake_waits_for_persistence_without_leasing_mutations",
        "direct_wake_reconciles_paused_goal_claim_only_under_operation_lease",
        "queued_inbox_and_cancellation_do_not_block_runtime_timers",
        "shutdown_closes_admission_before_waiting_for_caller_capacity",
        "compaction_lifecycle_waits_off_runtime_behind_durable_publication",
        "lifecycle_overload_retries_do_not_open_replay_gaps",
        "selected_compaction_terminal_survives_cancelled_publication_wait",
        "committed_compaction_drop_cannot_publish_cancelled",
        "cancellation_drop_restores_local_run_during_caller_saturation"],
    "session_service::attention::tests::continuation::": [
        "failed_successor_retires_predecessor_continuing_at_idle",
        "suppressed_successor_completion_does_not_resurface_continuing_after_real_reject",
        "owner_selected_goal_retry_receipt_survives_idle_callbacks_and_handoff"],
    "session_service::attention::tests::goal_free::": [
        "goal_free_settlement_preserves_run_when_preflight_input_is_cancelled",
        "attention_goal_free_real_owned_models_continue_queue_then_complete_only_final_run",
        "attention_goal_free_selector_rejects_unverified_empty_wrong_outcome_and_foreign_lease",
        "attention_goal_free_actual_older_completion_cannot_replace_newer_idle_run",
        "attention_f1_three_real_runs_reject_delayed_a_while_c_is_active"],
    "session_service::attention::tests::": [
        "callback_panic_during_real_admission_and_settlement_never_strands_run_task_or_lease",
        "real_selector_distinguishes_unverified_idle_foreign_owner_and_stopping"],
}
CORE = [prefix + name for prefix, names in CORE_GROUPS.items() for name in names]
SERVER_LEAVES = [
    "semantic_g2_real_http_direct_idle_before_publish_keeps_exact_a_during_b_and_replays",
    "semantic_g2_real_http_dwo_idle_unverified_before_publication_attempt_keeps_exact_a_during_b_and_replays",
    "semantic_fixture_teardown_waits_for_accepted_read_after_sqlite_returns",
    "semantic_cleanup_census_is_bounded_and_does_not_follow_replaced_roots_or_children",
    "semantic_cleanup_reports_original_failure_and_retains_failed_path",
]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    source_p, source_l, evidence = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    deadline = int(os.environ["CONTROL_STARTED"]) + 2400
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("forty-minute work budget")))
    signal.setitimer(signal.ITIMER_REAL, max(1, deadline - time.time()))
    base_env = {k: v for k, v in os.environ.items()
                if not k.startswith("NEXTEST_") and k not in ("GITHUB_TOKEN", "GH_TOKEN")}
    result = {"status": "UNEXPECTED_FAILURE", "started_epoch": time.time(), "commands": [],
              "harness": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "attempt": os.environ["GITHUB_RUN_ATTEMPT"], "L": L, "P": P,
              "bindings": {}, "phase": "binding", "historical_writer": "UNKNOWN"}

    def run(label, source, environment, command, json_output=False):
        result["phase"] = label
        entry = {"label": label, "source": str(source), "target": environment.get("CARGO_TARGET_DIR"),
                 "argv": list(map(str, command)), "started_epoch": time.time()}
        result["commands"].append(entry)
        require(time.time() < deadline, "work budget exhausted before " + label)
        with contextlib.ExitStack() as stack:
            output = stack.enter_context((evidence / (label + ".log")).open("xb"))
            error = (stack.enter_context((evidence / (label + "-stderr.log")).open("xb"))
                     if json_output else subprocess.STDOUT)
            child = subprocess.Popen(list(map(str, command)), cwd=source, env=environment,
                                     stdout=output, stderr=error, start_new_session=True)
            try:
                code = child.wait(timeout=max(0.1, deadline - time.time()))
            except BaseException:
                if child.poll() is None:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        child.wait(timeout=25)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=5)
                raise
            finally:
                entry.update(exit=child.poll(), finished_epoch=time.time())
        print(f"{label}: original exit={code}", flush=True)
        require(code == 0, label + " failed; no subsequent phase")

    def clean(source):
        return not subprocess.check_output(["git", "status", "--porcelain"], cwd=source)

    def binding(label, source, sha, hashes):
        require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source).decode().strip() == sha, "wrong source")
        require(subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=source).decode().strip() == TREES[label], "wrong tree")
        require(clean(source), "dirty source")
        for name, digest in hashes.items():
            require(hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, "reviewed file mismatch")
        result["bindings"][label] = {"sha": sha, "tree": TREES[label], "path": str(source), "hashes": hashes}

    def listed(label, source, environment, arguments, expected=None):
        run(label, source, environment, [binary, "nextest", "list", *arguments, "--message-format", "json"], True)
        data = json.loads((evidence / (label + ".log")).read_text())
        selected, binaries = [], []
        for suite in data["rust-suites"].values():
            names = [name for name, case in suite.get("testcases", {}).items()
                     if case["filter-match"]["status"] == "matches" and not case["ignored"]]
            if names:
                path = Path(suite["binary-path"]).resolve(strict=True)
                require(path.is_relative_to(Path(environment["CARGO_TARGET_DIR"])), "binary target attribution mismatch")
                binaries.append({"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
                selected.extend(names)
        require(selected and (expected is None or len(selected) == len(set(selected))), "duplicate/empty selection")
        if expected is not None:
            require(set(selected) == set(expected) and len(selected) == len(expected), "missing/extra selected case")
        result[label] = {"selected": selected, "binaries": binaries}
        return selected

    def junit(runtime, expected):
        paths = list(runtime.glob("store/**/junit.xml"))
        require(len(paths) == 1, "missing/ambiguous retained JUnit")
        cases = ET.parse(paths[0]).getroot().findall(".//testcase")
        executed = [case for case in cases if case.find("skipped") is None]
        require(len(executed) == len(expected) and {case.attrib["name"] for case in executed} == set(expected), "JUnit selection mismatch")
        require(all(case.find("failure") is None and case.find("error") is None for case in executed), "JUnit nonpass")
        return {"total": len(cases), "executed": len(executed), "passed": len(executed), "path": str(paths[0])}

    try:
        require(platform.system() == "Linux" and platform.machine() == "x86_64", "wrong runner")
        require(os.environ["GITHUB_RUN_ATTEMPT"] == "1" and "NAC_HUMAN_CRASH_STORE" not in base_env, "wrong attempt/external store")
        require(subprocess.check_output(["node", "--version"]).decode().strip() == "v24.22.1", "wrong Node")
        require(subprocess.check_output(["rustc", "--version"]).decode().startswith("rustc 1.98.0 "), "wrong Rust")
        binding("P", source_p, P, P_HASHES)
        binding("L", source_l, L, L_HASHES)
        result["runner"] = {"system": platform.system(), "machine": platform.machine(), "image": os.environ.get("ImageVersion")}
        target_parent = Path(os.environ["RUNNER_TEMP"]) / ("candidate-targets-" + result["run_id"] + "-" + result["attempt"])
        target_parent.mkdir(mode=0o700)
        env_p, env_l = dict(base_env, CARGO_TARGET_DIR=str(target_parent / "P")), dict(base_env, CARGO_TARGET_DIR=str(target_parent / "L"))
        run("P-setup", source_p, env_p, ["make", "setup"])
        require(clean(source_p), "P setup changed source")
        sys.path.insert(0, str(source_p / ".github/scripts"))
        spec = importlib.util.spec_from_file_location("candidate_policy", source_p / ".github/scripts/server-tests.py")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        policy.temp_parent(env_p, source_p)
        binary = str(policy.install(evidence / "tool"))
        run("nextest-version", source_p, env_p, [binary, "--version"])
        result["nextest"] = {"version": policy.install.__globals__["VERSION"], "archive_sha256": policy.install.__globals__["SHA256"]}
        runtime_p = evidence / "runtime-P"
        runtime_l = evidence / "runtime-L-core"
        runtime_server = evidence / "runtime-L-server-manifest"
        for runtime in [runtime_p, runtime_l, runtime_server]:
            runtime.mkdir(mode=0o700)
        config_p = policy.private_config(runtime_p, source_p / ".github/nextest-ci.toml")
        config_l = policy.private_config(runtime_l, source_l / ".github/nextest-ci.toml")
        config_server = policy.private_config(runtime_server, source_l / ".github/nextest-ci.toml")
        for name in ["fixtures-P", "fixtures-L-core", "fixtures-L-server"]:
            (evidence / name).mkdir(mode=0o700)
        env_p["TMPDIR"] = str(evidence / "fixtures-P")
        common = ["--locked", "-p", "nac-core", "--lib", "--profile", "ci", "--user-config-file", "none"]
        args_p = common + ["--config-file", str(config_p), "-E", "test(=" + GREEN + ")"]
        listed("P-list", source_p, env_p, args_p, [GREEN])
        run_options = ["--no-tests", "fail", "--test-threads", "4", "--retries", "0", "--no-fail-fast", "--run-ignored", "default",
                       "--success-output", "immediate-final", "--failure-output", "immediate-final"]
        run("P-GREEN", source_p, env_p, [binary, "nextest", "run", *args_p, *run_options])
        result["P_junit"] = junit(runtime_p, [GREEN])
        receipts = [json.loads(line.split("fenced-original-continuation-drain-evidence ", 1)[1])
                    for line in (evidence / "P-GREEN.log").read_text().splitlines()
                    if "fenced-original-continuation-drain-evidence {" in line]
        require(receipts and all(item == receipts[0] for item in receipts), "missing/conflicting GREEN receipts")
        receipt = receipts[0]
        result["P_receipt"] = receipt
        for key in ["caller_entered", "caller_returned", "caller_operation_succeeded", "original_task_joined", "provider_joined",
                    "fence_pending_while_original_held", "fence_returned_none", "typed_drain_acknowledged", "old_db_bytes_preserved", "owned_root_absent"]:
            require(receipt[key] is True, "GREEN missing true: " + key)
        for key in ["active_at_hold", "original_pending_before_drain", "original_pending_after_drain", "selected_path_recreated"]:
            require(receipt[key] is False, "GREEN missing false: " + key)
        owned = Path(receipt["root"])
        require(receipt["model_requests"] == 1 and receipt["session"] == "session" and receipt["run"], "GREEN identity/count")
        require(owned.parent == evidence / "fixtures-P" and owned.name.startswith("nac_original_settlement_tail_")
                and not owned.exists() and not list((evidence / "fixtures-P").iterdir()), "GREEN physical absence")
        require(clean(source_p), "P execution changed source")
        run("L-setup", source_l, env_l, ["make", "setup"])
        require(clean(source_l), "L setup changed source")
        env_l["TMPDIR"] = str(evidence / "fixtures-L-core")
        args_l = common + ["--config-file", str(config_l), "-E", " | ".join("test(=" + name + ")" for name in CORE)]
        listed("L-core-list", source_l, env_l, args_l, CORE)
        run("L-core", source_l, env_l, [binary, "nextest", "run", *args_l, *run_options])
        result["L_core_junit"] = junit(runtime_l, CORE)
        env_l["TMPDIR"] = str(evidence / "fixtures-L-server")
        args_server = ["--locked", "-p", "nac-server", "--config-file", str(config_server), "--profile", "ci", "--user-config-file", "none"]
        server_names = listed("L-server-manifest", source_l, env_l, args_server)
        required_server = []
        for leaf in SERVER_LEAVES:
            matches = [name for name in server_names if name.rsplit("::", 1)[-1] == leaf]
            require(len(matches) == 1, "canonical control missing/ambiguous: " + leaf)
            required_server.extend(matches)
        canonical_env = dict(env_l, GITHUB_TOKEN=os.environ.get("GITHUB_TOKEN", ""))
        run("L-canonical-server", source_l, canonical_env, ["python3", ".github/scripts/server-tests.py"])
        canonical = re.sub(r"\x1b\[[0-9;]*m", "", (evidence / "L-canonical-server.log").read_text())
        require("server nextest exit=0; doctest exit=0" in canonical, "canonical native/doc exits missing")
        starts = re.findall(r"Starting (\d+) tests? across (\d+) binar", canonical)
        require(len(starts) == 1 and int(starts[0][0]) == len(server_names), "canonical manifest/run count mismatch")
        for name in required_server:
            require(any(re.match(r"\s*PASS\s", line) and line.rstrip().endswith(name) for line in canonical.splitlines()), "required canonical case not PASS: " + name)
        result["canonical"] = {"raw_exit": 0, "nextest_exit": 0, "doctest_exit": 0, "started_tests": int(starts[0][0]),
                               "required_cases_passed": required_server, "JUnit": "private runtime removed normally by unchanged server-tests.py; full manifest/log retained"}
        require(clean(source_l) and clean(source_p), "reviewed source dirty")
        result["status"] = "P_GREEN_AND_L_CORE_AND_UNCHANGED_CANONICAL_SERVER_PASSED"
        return 0
    except BaseException as error:
        result["unexpected"] = type(error).__name__ + ": " + str(error)
        (evidence / "controller-error.log").write_text(traceback.format_exc())
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        result["finished_epoch"] = time.time()
        result["source_clean"] = {"P": clean(source_p), "L": clean(source_l)}
        (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError("controller terminated")))
    raise SystemExit(main())
