#!/usr/bin/env python3
"""One private diagnostic episode; a reproduced failing Rust test is not a pass."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
import traceback
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
SOURCE = "ab860841921c7daede3ad84e9bc6e74172395b56"
TREE = "9d55c41ecd829b57cb654bee20464b3a6acb5391"
CASE = "session_service::attention::tests::continuation::original_settlement_caller_cannot_recreate_store_after_typed_drain"
MARKER = "ORIGINAL_CONTINUATION_RECREATED_STORE_AFTER_DRAIN"
HASHES = {
    "attention_continuation_tests.rs": "c971aefb6a875b68f9ce6e5ecedce8a13e6b09dbee3c54ada60d3edeaf82b41b",
    "attention_test_support/continuation.rs": "3d7682b0ad0f428c7dfac874e4cc56528a9e4898595b9b9dd0ee66d1b67f6e57",
    "direct_interaction.rs": "caceddfabfac0e50a6023e554b0bbaabe8a160e1b093b6dc209409a281b3595e",
}


def main():
    source, evidence = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    deadline = int(os.environ["CONTROL_STARTED"]) + 40 * 60
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("owned work budget exhausted")))
    signal.setitimer(signal.ITIMER_REAL, max(1, deadline - time.time()))
    environment = {k: v for k, v in os.environ.items()
                   if not k.startswith("NEXTEST_") and k not in ("GITHUB_TOKEN", "GH_TOKEN")}
    result = {"source": SOURCE, "tree": TREE, "case": CASE, "commands": [],
              "harness": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
              "attempt": os.environ["GITHUB_RUN_ATTEMPT"], "historical_writer": "UNKNOWN",
              "disposition": "UNEXPECTED_FAILURE", "started_epoch": time.time()}

    def run(label, command):
        result["commands"].append({"label": label, "argv": list(map(str, command))})
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError("forty-minute owned work budget exhausted")
        with contextlib.ExitStack() as stack:
            log = stack.enter_context((evidence / (label + ".log")).open("xb"))
            stderr = (stack.enter_context((evidence / "list-stderr.log").open("xb"))
                      if label == "list" else subprocess.STDOUT)
            child = subprocess.Popen(list(map(str, command)), cwd=source, env=environment,
                                     stdout=log, stderr=stderr, start_new_session=True)
            try:
                code = child.wait(timeout=remaining)
            except BaseException:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=5)
                raise
        result["commands"][-1]["exit"] = code
        print(f"{label}: original exit={code}", flush=True)
        return code

    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    try:
        require(platform.system() == "Linux" and platform.machine() == "x86_64", "wrong runner")
        require(os.environ["GITHUB_RUN_ATTEMPT"] == "1", "first attempt required")
        require("NAC_HUMAN_CRASH_STORE" not in environment, "external crash store forbidden")
        require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source).decode().strip() == SOURCE,
                "source SHA mismatch")
        require(subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=source).decode().strip() == TREE,
                "source tree mismatch")
        for relative, digest in HASHES.items():
            require(hashlib.sha256((source / "crates/nac-core/src/session_service" / relative).read_bytes()).hexdigest()
                    == digest, "reviewed path hash mismatch")
        result["binding"] = {"system": platform.system(), "machine": platform.machine(), "hashes": HASHES,
                             "runner_os": os.environ.get("RUNNER_OS"), "image": os.environ.get("ImageVersion")}
        (evidence / "binding.json").write_text(json.dumps(result, indent=2) + "\n")
        require(run("setup", ["make", "setup"]) == 0, "setup failed; episode stopped")
        require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=source),
                "setup changed reviewed source")
        sys.path.insert(0, str(source / ".github/scripts"))
        spec = importlib.util.spec_from_file_location("server_policy", source / ".github/scripts/server-tests.py")
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        policy.temp_parent(environment, source)
        runtime = evidence / "runtime"
        runtime.mkdir(mode=0o700)
        config = policy.private_config(runtime, source / ".github/nextest-ci.toml")
        binary = policy.install(runtime / "tool")
        result["nextest"] = {"version": policy.install.__globals__["VERSION"],
                             "archive_sha256": policy.install.__globals__["SHA256"],
                             "config_sha256": hashlib.sha256(config.read_bytes()).hexdigest()}
        require(run("nextest-version", [binary, "--version"]) == 0, "nextest version failed")
        tmp = evidence / "fixtures"
        tmp.mkdir(mode=0o700)
        environment["TMPDIR"] = str(tmp)
        common = [str(binary), "nextest"]
        selection = ["--locked", "-p", "nac-core", "--lib", "-E", "test(=" + CASE + ")",
                     "--config-file", str(config), "--profile", "ci", "--user-config-file", "none"]
        require(run("list", common + ["list"] + selection + ["--message-format", "json"]) == 0,
                "build/list failed; episode stopped")
        listing = json.loads((evidence / "list.log").read_text())
        selected = []
        for suite in listing["rust-suites"].values():
            for name, case in suite.get("testcases", {}).items():
                if case["filter-match"]["status"] == "matches":
                    selected.append({"name": name, "ignored": case["ignored"]})
        result["selected"] = selected
        require(selected == [{"name": CASE, "ignored": False}], "not exactly the one required case")
        raw = run("characterization", common + ["run"] + selection + ["--no-tests", "fail",
                  "--test-threads", "4", "--retries", "0", "--no-fail-fast", "--run-ignored", "default",
                  "--failure-output", "immediate-final"])
        result["original_nextest_exit"] = raw
        log = (evidence / "characterization.log").read_text()
        junit = list(runtime.glob("store/**/junit.xml"))
        require(len(junit) == 1, "missing/ambiguous JUnit")
        cases = ET.parse(junit[0]).getroot().findall(".//testcase")
        executed = [case for case in cases if case.find("skipped") is None]
        failures = [case for case in cases if case.find("failure") is not None]
        result["junit"] = {"cases": len(cases), "executed": len(executed), "failures": len(failures),
                           "executed_names": [case.attrib["name"] for case in executed]}
        require(raw == 100 and len(executed) == len(failures) == 1
                and executed[0].attrib["name"] in (CASE, CASE.rsplit("::", 1)[1])
                and MARKER in ET.tostring(failures[0], encoding="unicode"), "not the exact expected failing case")
        receipts = []
        for line in log.splitlines():
            if "original-continuation-drain-evidence {" in line:
                receipts.append(json.loads(line.split("original-continuation-drain-evidence ", 1)[1]))
        require(bool(receipts) and all(item == receipts[0] for item in receipts), "missing/conflicting receipts")
        receipt = receipts[0]
        result["receipt"] = receipt
        for key in ["caller_entered", "caller_returned", "original_task_joined", "provider_joined",
                    "original_pending_after_drain", "typed_drain_acknowledged", "old_db_bytes_preserved",
                    "selected_path_recreated", "owned_root_absent"]:
            require(receipt[key] is True, "missing true receipt: " + key)
        require(receipt["active_at_hold"] is False and receipt["model_requests"] == 1
                and receipt["session"] == "session" and bool(receipt["run"]), "identity/frontier/count mismatch")
        owned = Path(receipt["root"])
        require(owned.parent == tmp and owned.name.startswith("nac_original_settlement_tail_")
                and not owned.exists() and not list(tmp.iterdir()), "owned root absence not observed")
        require(not subprocess.check_output(["git", "status", "--porcelain"], cwd=source),
                "characterization changed reviewed source")
        result["disposition"] = "CONTROLLED_MECHANISM_REPRODUCED_EXPECTED_RUST_TEST_FAILURE"
        return 0
    except BaseException as error:
        result["unexpected"] = type(error).__name__ + ": " + str(error)
        (evidence / "controller-error.log").write_text(traceback.format_exc())
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        result["finished_epoch"] = time.time()
        result["source_dirty"] = subprocess.check_output(["git", "status", "--porcelain"], cwd=source).decode()
        (evidence / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError("controller terminated")))
    raise SystemExit(main())
