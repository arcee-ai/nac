"""Private Q1 evidence reader/reducer. No app/provider launch or DB mutation."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import time

TABLES = ("session_inbox", "session_goals", "permission_grants", "human_shell_operations",
          "session_run_recovery", "session_run_outcomes", "session_goal_outcomes",
          "transcript_append_receipts", "thread_events")


def require(value, message):
    if not value:
        raise ValueError(message)


def plan_read(control):
    """Read one fixed private plan with no-follow descriptors and entry bookends."""
    fd = os.open(control, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    filefd = None
    try:
        parent = os.fstat(fd)
        require(parent.st_uid == os.getuid() and not parent.st_mode & 0o077, "control custody")
        filefd = os.open("storage-q1.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
        before = os.fstat(filefd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                before.st_uid == os.getuid() and not before.st_mode & 0o077 and
                0 < before.st_size <= 16384, "plan custody/bound")
        raw = b""
        while True:
            part = os.read(filefd, min(4096, 16385 - len(raw)))
            if not part:
                break
            raw += part
            require(len(raw) <= 16384, "plan grew")
        after = os.fstat(filefd)
        entry = os.stat("storage-q1.json", dir_fd=fd, follow_symlinks=False)
        current = os.lstat(control)
        for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"):
            require(getattr(before, key) == getattr(after, key), "plan changed")
        require(stat.S_ISREG(entry.st_mode) and (entry.st_dev, entry.st_ino) ==
                (before.st_dev, before.st_ino), "plan entry replaced")
        require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) ==
                (parent.st_dev, parent.st_ino), "control replaced")
        return raw
    finally:
        if filefd is not None:
            os.close(filefd)
        os.close(fd)


def sqlite_snapshot(path, pinned, sessions):
    """Actual schema, parameterized A/B reads, WAL-aware mode=ro, no migrations.

    For future use only on the separately admitted canonical disposable store.
    Missing tables, timeout, replacement or incomplete session pair FAIL.
    """
    path = Path(path)
    before = path.lstat()
    require(path == path.resolve(strict=True) and stat.S_ISREG(before.st_mode) and
            before.st_uid == os.getuid() and before.st_nlink == 1 and
            (before.st_dev, before.st_ino) == tuple(pinned), "DB custody")
    require(len(sessions) == 2 and len(set(sessions)) == 2, "session pair")
    end = time.monotonic() + 1
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.1)) as db:
        db.execute("PRAGMA query_only=ON")
        db.set_progress_handler(lambda: int(time.monotonic() >= end), 1000)
        db.execute("BEGIN")
        rows = db.execute("SELECT session_id,behavior,run_count,messages_json,"
                          "permission_approval_revision FROM sessions "
                          "WHERE session_id IN (?,?) ORDER BY session_id", sessions).fetchall()
        require(len(rows) == 2 and {x[0] for x in rows} == set(sessions), "missing session")
        require(all(x[1] == "direct" and type(x[2]) is int and x[2] == 0 for x in rows),
                "nonempty/non-direct session")
        require(all(len(x[3].encode()) <= 1048576 for x in rows), "transcript bound")
        result = {"sessions": [(x[0], x[1], x[2], hashlib.sha256(x[3].encode()).hexdigest(), x[4])
                               for x in rows], "counts": {}}
        for table in TABLES:  # Closed schema-owned names, values always parameters.
            result["counts"][table] = db.execute(
                "SELECT COUNT(*) FROM " + table + " WHERE session_id IN (?,?)", sessions).fetchone()[0]
        db.rollback()
    after = path.lstat()
    require((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), "DB replaced")
    return result


def assert_durable(ledger, expected, disk_sha, *, require_b_clear=True):
    require(0 < len(ledger) <= 96, "missing/overflow ledger")
    owner, accepted, completed, b_present, clear = None, {}, {}, None, None
    terminal = []
    for position, fact in enumerate(ledger):
        require(all(fact.get(k) == v for k, v in expected.items()), "foreign case/frame")
        owner = owner or fact.get("owner")
        require(owner and fact.get("owner") == owner, "foreign storage owner")
        seq = fact.get("sequence")
        require(type(seq) is int and seq >= 0, "sequence type")
        kind = fact.get("kind")
        require(kind in ("accepted", "completed", "flush"), "unavailable/unknown write fact")
        if kind != "flush":
            require(fact.get("writeClass") in ("ordinary", "native-notifications"), "write class")
            if fact["writeClass"] == "native-notifications":
                require(not any(k in fact for k in ("namespace", "keySHA256", "valueSHA256", "clear", "bPresent")),
                        "invented ordinary facts on native write")
            else:
                require(fact.get("namespace") in ("drafts", "preferences"), "ordinary namespace")
                require("bPresent" not in fact or (fact["namespace"] == "drafts" and
                        type(fact["bPresent"]) is bool), "untyped B fact")
        if kind == "accepted":
            require(seq > max(accepted, default=0), "reused/reordered acceptance")
            if accepted:
                require(seq == max(accepted) + 1, "missing enqueue acceptance")
            accepted[seq] = fact
            if fact.get("bPresent") is True:
                b_present = seq
            elif fact.get("bPresent") is False and b_present is not None:
                clear = seq
        elif fact["kind"] == "completed":
            require(seq in accepted and seq not in completed, "unknown/duplicate completion")
            require(all(fact.get(k) == accepted[seq].get(k) for k in
                        ("writeClass", "namespace", "keySHA256", "valueSHA256", "clear", "bPresent")),
                    "completion classification changed")
            require(fact.get("checkpointSHA256") == accepted[seq].get("checkpointSHA256"),
                    "completion content changed")
            require(fact.get("durable") is True, "failed write")
            require(seq > max(completed, default=0), "reordered completion")
            completed[seq] = position
        elif fact["kind"] == "flush" and fact.get("terminalQuitFlush") is True:
            require(fact.get("durable") is True, "Quit flush failed")
            terminal.append((seq, position))
    if require_b_clear:
        require(b_present is not None and clear is not None and clear > b_present,
                "B-present to B-clear transition absent")
    else:
        require(b_present is None, "B resurrected in restore launch")
    require(bool(accepted), "no actual enqueue")
    last = max(accepted)
    require(set(accepted) == set(completed), "pending write/old ACK")
    require(accepted[last].get("checkpointSHA256") == disk_sha, "disk/final completion mismatch")
    require(any(seq >= last and pos > max(completed.values()) for seq, pos in terminal),
            "final Quit flush absent/early")
    return {"lastAccepted": last, "clearSequence": clear, "durable": True,
            "nativeEnqueues": sum(x["writeClass"] == "native-notifications" for x in accepted.values())}


def assert_controlled_no_send(before, after, *, provider_dispatches, exclusive_actor,
                              only_q1_actions, request_log_overflow):
    """Claim only this closed controlled UI experiment, not all-world telemetry."""
    require(before == after, "durable session facts changed")
    require(all(before["counts"][k] == 0 for k in TABLES if k != "thread_events"),
            "nonempty baseline obligations")
    require(type(provider_dispatches) is int and provider_dispatches == 0, "provider dispatch")
    require(exclusive_actor is True and only_q1_actions is True and request_log_overflow is False,
            "unqualified controlled interval")
    return {"scope": "exclusive seeded Q1 UI actions + durable facts + provider owner census",
            "transientExecutionIntervalCensus": "not claimed",
            "transientPermissionIntervalCensus": "not claimed"}
