#!/usr/bin/env python3
"""Bounded dummy-only Responses provider for the ALL-353 workload manifest."""

import argparse
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
            maximum = WORKLOAD["transcript"]["turns"] if self.server.mode == "transcript" else 1
            if index >= maximum:
                self.server.record("rejected_extra_request", request_index=index)
                self.send_error(409, "Fixture plan exhausted; no replay")
                return
            expected = transcript(index)["user"] if self.server.mode == "transcript" else "MAC_PERF_V1_STREAM"
            if expected not in json.dumps(request):
                self.server.record("rejected_wrong_prompt", request_index=index)
                self.send_error(409, "Expected next fixture prompt")
                return
            self.server.sequence += 1
            parts = [transcript(index)["assistant"]] if self.server.mode == "transcript" else stream_parts()
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
                interval = WORKLOAD["stream"]["interval_ms"] * 1_000_000 if self.server.mode == "stream" else 0
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
    parser.add_argument("--mode", choices=["transcript", "stream"], required=True)
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
