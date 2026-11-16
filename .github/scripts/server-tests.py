#!/usr/bin/env python3
"""Run the full server package with private nextest state and separate doctests."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import tomllib

sys.dont_write_bytecode = True
from nextest_tool import install

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / ".github/nextest-ci.toml"
SHUTDOWN_TERM_SECONDS = 15
SHUTDOWN_KILL_SECONDS = 5
CONTROL_LISTENER_TESTS = (
    "failed_listener_bind_keeps_accepted_candidate_in_maintenance",
    "every_replacement_readiness_failure_keeps_maintenance_and_diagnostics",
    "fully_ready_replacement_accepts_only_after_both_listeners_bind",
)
CONTROL_LISTENER_FILTER = ("package(=nac-server) & test(/^managed_control::tests::("
                           + "|".join(CONTROL_LISTENER_TESTS) + ")$/)")
OAUTH_LOOPBACK_TESTS = (
    "loopback_retry_reuses_only_its_own_live_callback_listener",
    "loopback_replacement_rejects_the_old_accepted_callback",
    "loopback_failed_export_preserves_404_rejection_and_callback_ownership",
)
OAUTH_LOOPBACK_FILTER = ("package(=nac-server) & test(/^tests::mcp_oauth::loopback::("
                         + "|".join(OAUTH_LOOPBACK_TESTS) + ")$/)")
POLICY = {"test-groups": {"managed-control-port3211": {"max-threads": 1},
                          "oauth-loopback-port1456": {"max-threads": 1}}, "profile": {"ci": {
    "retries": 0, "fail-fast": False, "test-threads": 4,
    "leak-timeout": {"period": "200ms", "result": "fail"},
    "junit": {"path": "junit.xml", "report-skipped": "all"},
    "overrides": [{"filter": CONTROL_LISTENER_FILTER, "test-group": "managed-control-port3211"},
                  {"filter": OAUTH_LOOPBACK_FILTER, "test-group": "oauth-loopback-port1456"}],
}}}


def private_config(runtime, profile=PROFILE):
    source = profile.read_text()
    if json.dumps(tomllib.loads(source), sort_keys=True) != json.dumps(POLICY, sort_keys=True):
        raise ValueError("CI nextest policy drift (including filters, overrides or deadlines)")
    config = runtime / "nextest.toml"
    config.write_text("[store]\ndir = " + json.dumps(str(runtime / "store")) + "\n\n" + source)
    config.chmod(0o600)
    return config


def temp_parent(environment, workspace=ROOT):
    value = environment.get("RUNNER_TEMP", "")
    if not value or not Path(value).is_absolute():
        raise ValueError("RUNNER_TEMP must be an absolute existing directory")
    parent = Path(value).resolve(strict=True)
    if not parent.is_dir():
        raise ValueError("RUNNER_TEMP must be a directory")
    forbidden = [workspace.resolve(), (workspace / "target").resolve(),
                 Path(environment.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve(),
                 Path(environment.get("CARGO_TARGET_DIR", str(workspace / "target"))).resolve()]
    if any(parent == path or parent.is_relative_to(path) for path in forbidden):
        raise ValueError("nextest runtime must be outside workspace and compiler caches")
    return parent


def execute(command, environment, cwd=ROOT):
    print("server test command: " + " ".join(map(str, command)), flush=True)
    child = subprocess.Popen(list(map(str, command)), cwd=cwd, env=environment,
                             start_new_session=True)
    try:
        return child.wait()
    except BaseException:
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                # Controller cancellation only: allow nextest's native grace
                # period, then settle only the group this invocation created.
                child.wait(timeout=SHUTDOWN_TERM_SECONDS)
            except subprocess.TimeoutExpired:
                print("server controller: TERM grace expired; killing owned command group", flush=True)
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=SHUTDOWN_KILL_SECONDS)
        raise


def suite(binary, config, environment, run=execute):
    cargo = environment.get("CARGO", "cargo")
    # No target selector: also preserves default example compilation.
    compile_result = run([cargo, "test", "--locked", "-p", "nac-server", "--no-run"], environment)
    if compile_result:
        return compile_result
    result = run([binary, "nextest", "run", "--locked", "-p", "nac-server",
                  "--config-file", config, "--profile", "ci", "--user-config-file", "none",
                  "--test-threads", "4", "--retries", "0", "--no-fail-fast",
                  "--run-ignored", "default"], environment)
    # A failed native run must remain failed, and must not suppress doctests.
    docs = run([cargo, "test", "--locked", "-p", "nac-server", "--doc", "--no-fail-fast"], environment)
    print(f"server nextest exit={result}; doctest exit={docs}", flush=True)
    return result or docs


def main():
    environment = {key: value for key, value in os.environ.items() if not key.startswith("NEXTEST_")}
    for name in ["CARGO_PROFILE_DEV_DEBUG", "CARGO_PROFILE_TEST_DEBUG", "CARGO_INCREMENTAL"]:
        if environment.get(name) != "0":
            raise ValueError(f"{name} must remain zero")
    parent = temp_parent(environment)
    with tempfile.TemporaryDirectory(prefix="nac-server-tests-", dir=parent) as directory:
        runtime = Path(directory)
        print(f"private nextest runtime: {runtime}", flush=True)
        config = private_config(runtime)
        binary = install(runtime / "tool")
        return suite(binary, config, environment)


def interrupted(*_):
    raise KeyboardInterrupt


if __name__ == "__main__":
    if len(sys.argv) != 1:
        raise SystemExit("server-tests accepts no target selectors or policy overrides")
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main())
