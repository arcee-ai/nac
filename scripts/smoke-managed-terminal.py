#!/usr/bin/env python3
"""Human PTY smoke inside the existing managed-image container, with no model run.

Uses that runtime's accepted bootstrap/host and repository mount. This directly
exercises internal HTTP; it does not qualify Envoy, gVisor, or a deployed host.
"""
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HOST = "managed-smoke.test"
BASE = "http://127.0.0.1:3210"
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_TRANSCRIPT_BYTES = 512 * 1024


class SmokeFailure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise SmokeFailure(message)


def cursor(value):
    require(
        isinstance(value, str) and value.isascii() and value.isdecimal()
        and len(value) <= 20 and (value == "0" or not value.startswith("0")),
        "invalid observer byte cursor",
    )
    result = int(value)
    require(result <= 2**64 - 1, "observer byte cursor overflow")
    return result


class Api:
    def __init__(self):
        # Never forward this internal runtime probe through an ambient proxy.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, method, path, body=None, expected=200):
        payload = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            BASE + path, data=payload, method=method,
            headers={"Host": HOST, "Origin": "http://" + HOST,
                     "Content-Type": "application/json"},
        )
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            # Provider/bootstrap values and raw response bodies are never logged.
            raise SmokeFailure(f"HTTP {method} failed with status {error.code}") from None
        except (OSError, urllib.error.URLError):
            raise SmokeFailure(f"HTTP {method} transport failed") from None
        with response:
            require(response.status == expected, f"unexpected HTTP {method} status")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        require(len(raw) <= MAX_RESPONSE_BYTES, "HTTP response exceeded fixture bound")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            raise SmokeFailure("HTTP response was not valid JSON") from None


class Observer:
    def __init__(self, api, terminal_path):
        self.api = api
        attached = api.call("POST", terminal_path + "/observers",
                            {"protocol_version": 1, "page_limit": 4096})
        identifier = str(uuid.UUID(attached["observer_id"]))
        self.path = terminal_path + "/observers/" + identifier
        self.acknowledgement = None
        self.transcript = bytearray()
        self.position = 0

    def read_until(self, marker):
        deadline = time.monotonic() + 15
        while marker not in self.transcript:
            require(time.monotonic() < deadline, "PTY output marker timed out")
            frame = self.api.call("POST", self.path + "/read", {
                "protocol_version": 1,
                "acknowledge_offset": self.acknowledgement,
                "acknowledge_reset": False, "wait_ms": 100,
            })
            require(not frame["gap"], "small fixture unexpectedly exceeded retained output")
            values = frame["bytes"]
            require(isinstance(values, list) and len(values) <= 4096
                    and all(type(value) is int and 0 <= value <= 255 for value in values),
                    "invalid or oversized PTY byte page")
            offset, next_offset = cursor(frame["offset"]), cursor(frame["next_offset"])
            require(next_offset == offset + len(values), "PTY page span did not match bytes")
            require(offset == self.position, "observer cursor did not advance")
            self.position = next_offset
            self.transcript.extend(values)
            require(len(self.transcript) <= MAX_TRANSCRIPT_BYTES, "PTY transcript exceeded bound")
            # Processing finished before the exact next-cursor acknowledgement.
            self.acknowledgement = frame["next_offset"] if frame["requires_ack"] else None
        return bytes(self.transcript)

    def detach(self):
        self.api.call("DELETE", self.path, expected=204)


def input_bytes(api, terminal_path, data):
    api.call("POST", terminal_path + "/input",
             {"protocol_version": 1, "bytes": list(data)}, expected=204)


def settled(api, terminal_path):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        status = api.call("GET", terminal_path)
        # Collector EOF and native cleanup are separate completion facts.
        if (not status["alive"] and status["output_complete"]
                and type(status["exit_code"]) is int):
            require(status["output_error"] is None, "PTY collector failed")
            return
        time.sleep(0.05)
    raise SmokeFailure("native ownership and output EOF did not settle")


def main():
    require(os.getuid() == 10001 and os.getgid() == 10001,
            "fixture must execute as managed UID/GID 10001:10001")
    api = Api()
    fixture = Path(tempfile.mkdtemp(prefix="nac-terminal-smoke.", dir="/repositories"))
    session = None
    terminal = None
    observers = []
    cleanup_errors = []
    try:
        created = api.call("POST", "/sessions", {
            "behavior": "direct", "cwd": str(fixture),
            "ssh_host": None, "sandbox": {"enabled": False},
        }, expected=201)
        metadata = created["metadata"]
        session = metadata["session_id"]
        require(metadata["behavior"] == "direct" and metadata["cwd"] == str(fixture),
                "session did not preserve its direct repository selection")
        summaries = api.call("GET", "/sessions")
        summary = next(item["summary"] for item in summaries
                       if item["summary"]["session_id"] == session)
        # `backend` in metadata names the model provider, not execution.
        require(summary["ssh_host"] is None and not summary["sandboxed"],
                "session did not select the Local execution backend")
        api.call("PUT", f"/sessions/{session}/permissions/mode",
                 {"mode": "auto_approve"}, expected=204)
        opened = api.call("POST", f"/sessions/{session}/user-terminals", {
            "protocol_version": 1, "launch_id": str(uuid.uuid4()), "cols": 80, "rows": 24,
        })
        terminal = opened["terminal_id"]
        terminal_path = f"/sessions/{session}/user-terminals/{terminal}"
        close_path = f"/sessions/{session}/terminals/{terminal}"
        require(opened["alive"], "new human terminal was not live")
        observer = Observer(api, terminal_path)
        observers.append(observer)
        input_bytes(api, terminal_path, (
            "stty -echo -onlcr; PS1=; PROMPT_COMMAND=; "
            "bind 'set enable-bracketed-paste off' 2>/dev/null; "
            "printf 'UID=%s\\nGID=%s\\nHOME=%s\\nPWD=%s\\n' "
            '"$(id -u)" "$(id -g)" "$HOME" "$PWD"; '
            "for tool in bash git git-lfs rg python3 node cargo; do "
            'command -v "$tool" >/dev/null || exit 93; done; '
            "printf 'NAC-PTY-%s\\n' READY; read -r literal; "
            'printf "LITERAL=%s\\n" "$literal"; '
            "printf 'NAC-INPUT-%s\\n' OK\r"
        ).encode())
        output = observer.read_until(b"NAC-PTY-READY\n")
        require(f"UID=10001\nGID=10001\nHOME=/home/nac\nPWD={fixture}\n".encode() in output,
                "PTY did not inherit the managed runtime identity, HOME and repository")
        # These are literal bytes, not model key names or a Ctrl-C signal.
        input_bytes(api, terminal_path, b"CTRL-C ENTER\r")
        output = observer.read_until(b"NAC-INPUT-OK\n")
        require(b"LITERAL=CTRL-C ENTER\n" in output, "input was not delivered literally")
        api.call("POST", terminal_path + "/resize",
                 {"protocol_version": 1, "cols": 91, "rows": 31}, expected=204)
        input_bytes(api, terminal_path, (
            'printf "SIZE=%s\\n" "$(stty size)"; '
            "git init --quiet . && printf 'terminal-written-value\\n' > terminal.txt && "
            "git add terminal.txt && git -c user.name='Managed terminal smoke' "
            "-c user.email='managed-smoke@example.test' -c commit.gpgsign=false "
            "commit --quiet -m 'Terminal fixture' && "
            "printf 'NAC-TOOLS-%s\\n' OK\r"
        ).encode())
        output = observer.read_until(b"NAC-TOOLS-OK\n")
        require(b"SIZE=31 91\n" in output, "resize did not reach the genuine PTY")
        require((fixture / "terminal.txt").read_bytes() == b"terminal-written-value\n",
                "terminal did not write its selected repository")
        api.call("DELETE", close_path, expected=204)
        settled(api, terminal_path)
        api.call("DELETE", close_path, expected=204)
        replay = Observer(api, terminal_path)
        observers.append(replay)
        output = replay.read_until(b"NAC-TOOLS-OK\n")
        require(b"LITERAL=CTRL-C ENTER\n" in output and b"SIZE=31 91\n" in output,
                "retained output was lost across explicit close and independent attach")
    finally:
        for observer in observers:
            try:
                observer.detach()
            except SmokeFailure:
                cleanup_errors.append("observer detach")
        if terminal is not None:
            try:
                api.call("DELETE", f"/sessions/{session}/terminals/{terminal}", expected=204)
                settled(api, f"/sessions/{session}/user-terminals/{terminal}")
            except SmokeFailure:
                cleanup_errors.append("owned terminal cleanup")
        if session is not None:
            try:
                api.call("DELETE", f"/sessions/{session}")
            except SmokeFailure:
                cleanup_errors.append("owned session cleanup")
        # Keep the fixture actionable on a failed ownership cleanup. The outer
        # canonical smoke trap owns final disposable container/volume teardown.
        if not cleanup_errors:
            shutil.rmtree(fixture)
        require(not cleanup_errors, "managed terminal fixture cleanup failed: "
                + ", ".join(cleanup_errors))
    print("managed human terminal HTTP smoke: ok (same runtime, Local UID 10001)")


if __name__ == "__main__":
    try:
        main()
    except SmokeFailure as error:
        # These diagnostics contain only fixture-authored labels/status codes.
        raise SystemExit("managed human terminal HTTP smoke: " + str(error)) from None
    except (KeyError, StopIteration, OSError, ValueError):
        # Never print malformed payloads, environment, or credential data.
        raise SystemExit("managed human terminal HTTP smoke: malformed fixture response") from None
