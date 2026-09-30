#!/usr/bin/env python3
"""Bounded separate-file matrix; retains failed lanes without retrying them."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import threading
import time


def invoke(command, directory, name):
    out = directory / (name + ".stdout")
    err = directory / (name + ".stderr")
    started = time.monotonic()
    timed_out = []
    with out.open("w") as stdout, err.open("w") as stderr:
        child = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                 start_new_session=True)

        def terminate():
            timed_out.append(True)
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

        watchdog = threading.Timer(45, terminate)
        watchdog.start()
        _, status, usage = os.wait4(child.pid, 0)
        watchdog.cancel()
        child.returncode = os.waitstatus_to_exitcode(status)
    value = None
    try:
        value = json.loads(out.read_text().strip().splitlines()[-1])
    except (ValueError, IndexError):
        pass
    return {"command": command, "exit": child.returncode,
            "timed_out": bool(timed_out), "wall_ms": (time.monotonic()-started)*1000,
            "cpu_user_us": int(usage.ru_utime*1e6),
            "cpu_system_us": int(usage.ru_stime*1e6),
            "peak_rss_bytes": usage.ru_maxrss*(1 if platform.system()=="Darwin" else 1024),
            "value": value, "stderr": err.read_text(),
            "stdout_path": str(out), "stderr_path": str(err)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--fixtures", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--schema", default=str(Path(__file__).with_name("schema-v29.sql")))
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    fixtures = Path(args.fixtures)
    schema = str(Path(args.schema).resolve())
    evidence = {"scope": "store-stage-only", "platform": platform.platform(),
                "binary_sha256": hashlib.sha256(Path(binary).read_bytes()).hexdigest(),
                "schema_sha256": hashlib.sha256(Path(schema).read_bytes()).hexdigest(),
                "seed": 168886546, "turso_version": "0.8.1", "lanes": []}
    for mode in ["sqlite", "syscall", "uring", "mvcc"]:
        for fixture in ["fresh", "copied"]:
            for count in [1, 2, 4]:
                name = f"{mode}-{fixture}-{count}"
                store = output / (name + ".db")
                lane = {"mode": mode, "fixture": fixture, "orchestrators": count}
                if fixture == "copied":
                    source = fixtures / f"168886546-{count}.db"
                    if not source.exists():
                        source = fixtures / f"seed-168886546-orchestrators-{count}.db"
                    lane["fixture_sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
                    shutil.copyfile(source, store)
                elif mode == "sqlite":
                    import sqlite3
                    with sqlite3.connect(store) as conn:
                        conn.executescript(Path(schema).read_text())
                else:
                    lane["prepare"] = invoke([binary, "probe", mode, str(store), schema],
                                             output, name+"-prepare")
                    if lane["prepare"]["exit"] != 0:
                        evidence["lanes"].append(lane)
                        (output/"matrix.json").write_text(json.dumps(evidence, indent=2)+"\n")
                        print(name, "PREPARE_FAILED", flush=True)
                        continue
                lane["workload"] = invoke([binary, "workload", mode, str(store), str(count)],
                                          output, name+"-workload")
                lane["files"] = {p.name: p.stat().st_size for p in output.glob(name+".db*")}
                evidence["lanes"].append(lane)
                (output/"matrix.json").write_text(json.dumps(evidence, indent=2)+"\n")
                print(name, lane["workload"]["exit"], flush=True)
    # A failed configuration is a qualification result, not a harness retry.
    print(output/"matrix.json")


if __name__ == "__main__":
    main()
