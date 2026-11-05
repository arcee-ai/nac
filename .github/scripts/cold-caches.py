#!/usr/bin/env python3
"""Select cache-read isolation from an exact PR marker or typed manual input."""
import json
import os
import stat
from pathlib import Path

MARKER = "<!-- nac-ci-cold-caches -->"
MAX_EVENT_BYTES = 8 * 1024**2


def unique_fields(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate event field")
        value[key] = item
    return value


def select(event_name, event, dispatch_input):
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    if event_name == "pull_request":
        request = event.get("pull_request")
        if not isinstance(request, dict):
            raise ValueError("missing pull request event")
        body = request.get("body")
        if body is not None and not isinstance(body, str):
            raise ValueError("pull request body must be text or null")
        # Only LF or CRLF is a line ending. No whitespace, quote, fence or
        # later prose/example can turn into an initial marker.
        return body is not None and (body == MARKER or body.startswith(MARKER + "\n") or
                                     body.startswith(MARKER + "\r\n"))
    if event_name == "workflow_dispatch":
        typed = json.loads(dispatch_input)
        if type(typed) is not bool:
            raise ValueError("manual cache input must be a typed boolean")
        return typed
    if event_name == "push":
        return False
    raise ValueError("unsupported cache selector event")


def main():
    path = Path(os.environ["GITHUB_EVENT_PATH"])
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("event must be a regular file")
        raw = source.read(MAX_EVENT_BYTES + 1)
    if len(raw) > MAX_EVENT_BYTES:
        raise ValueError("event exceeds metadata bound")
    event = json.loads(raw, object_pairs_hook=unique_fields)
    cold = select(os.environ["GITHUB_EVENT_NAME"], event, os.environ.get("DISPATCH_COLD_CACHES", "null"))
    print("cold_caches=" + str(cold).lower())


if __name__ == "__main__":
    main()
