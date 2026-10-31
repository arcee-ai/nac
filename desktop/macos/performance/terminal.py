#!/usr/bin/env python3
"""Finite dummy output source; invoke explicitly inside the fixture's owned PTY."""

import argparse
import json
import os
from pathlib import Path
import time


SPEC = json.loads(Path(__file__).with_name("workloads.json").read_bytes())["terminal"]


def batch_bytes(batch):
    result = bytearray()
    for line in range(SPEC["lines_per_batch"]):
        index = batch * SPEC["lines_per_batch"] + line
        prefix = f"MAC_PERF_V1_LINE_{index:06d} ".encode("ascii")
        result.extend(prefix.ljust(SPEC["line_ascii_bytes_including_lf"] - 1, b"."))
        result.extend(b"\n")
    return bytes(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True, type=Path, help="New producer-only JSONL")
    args = parser.parse_args()
    interval = 1_000_000_000 // SPEC["batches_per_second"]
    count = SPEC["duration_seconds"] * SPEC["batches_per_second"]
    with args.evidence.open("x") as log:
        start = time.monotonic_ns()
        total = 0
        for batch in range(count):
            scheduled = start + batch * interval
            wait = (scheduled - time.monotonic_ns()) / 1_000_000_000
            if wait > 0:
                time.sleep(wait)
            payload = batch_bytes(batch)
            emitted = 0
            try:
                while emitted < len(payload):
                    written = os.write(1, payload[emitted:])
                    if written <= 0:
                        raise OSError("No output progress")
                    emitted += written
            finally:
                total += emitted
                log.write(json.dumps({"schema": "nac-mac-perf-terminal-v1", "batch": batch,
                    "scheduled_ns": scheduled, "written_ns": time.monotonic_ns(),
                    "source_bytes": emitted, "total_source_bytes": total}) + "\n")
                log.flush()
        # Preserve the entire final scheduled interval in the workload lifetime.
        wait = (start + count * interval - time.monotonic_ns()) / 1_000_000_000
        if wait > 0:
            time.sleep(wait)


if __name__ == "__main__":
    main()
