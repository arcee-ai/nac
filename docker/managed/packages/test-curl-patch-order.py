#!/usr/bin/env python3
"""Check the exact upstream curl cleanup-order fix and its patch reversal.

This is source-order evidence, not a runtime use-after-free reproducer.
"""

import hashlib
import pathlib
import re
import subprocess
import tempfile


SOURCE = pathlib.Path("/work/curl/lib/multi.c")
PATCH = pathlib.Path("/recipe/curl-multi-done.patch")
FIXED_SHA256 = "515ac0f1295a3c0c74d59e08059e7a6a4195bc1fe3fcbc5a7c58846149979a8a"
REVERSED_SHA256 = "618a889e8f9268350239c05d58a3ff9af927fe0cf19e9be3c9436e73556344d3"
PATCH_SHA256 = "6f6d9a0dc69501c6e52f8841f2e9cbd843027a5cec1856d54e1de8799be88292"


def checked_bytes(path: pathlib.Path, expected: str) -> bytes:
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        raise AssertionError(f"{path}: SHA256 {actual}, expected {expected}")
    return data


def corrected_order(source: str) -> bool:
    start = source.index("static CURLcode multi_done(")
    end = source.index("/* flush the netrc cache */", start)
    body = source[start:end]
    calls = (
        "Curl_req_done(&data->req, data, premature)",
        "Curl_conn_ev_data_done(data, premature)",
        "Curl_detach_connection(data)",
        "Curl_cpool_return(data, conn, multi_done_locked, &mdctx, pnow)",
        "multi_schedule_pending(data->multi)",
    )
    if any(body.count(call) != 1 for call in calls):
        return False
    positions = [body.index(call) for call in calls]
    if positions != sorted(positions):
        return False
    between = body[positions[3] : positions[4] + len(calls[4])]
    return re.search(r"if\s*\(data->multi\)\s*multi_schedule_pending", between) is not None


checked_bytes(PATCH, PATCH_SHA256)
fixed = checked_bytes(SOURCE, FIXED_SHA256)
if not corrected_order(fixed.decode("utf-8")):
    raise AssertionError("locked curl source lacks corrected multi_done ordering")

with tempfile.TemporaryDirectory(prefix="curl-order-") as root:
    copy = pathlib.Path(root, "lib", "multi.c")
    copy.parent.mkdir()
    copy.write_bytes(fixed)
    subprocess.run(
        ["patch", "-R", "--batch", "--fuzz=0", "-p1", "-i", str(PATCH)],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    reversed_source = checked_bytes(copy, REVERSED_SHA256)
    if corrected_order(reversed_source.decode("utf-8")):
        raise AssertionError("exact upstream patch reversal still has corrected ordering")

print("curl multi_done: locked fixed ordering present; exact patch reversal rejected")
