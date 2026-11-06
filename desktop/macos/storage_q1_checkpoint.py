"""Private Q1 witness; tested only on inert fixtures. Reads only the owner's pinned disposable tree.

No application launch, mutation, SQLite open, polling, cleanup or durability claim.
The caller supplies the actual bootstrap binding and pinned root device/inode.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import unicodedata

LIMIT = 8 * 1024 * 1024
FIELDS = ("owner", "profile", "organization", "host", "store", "track")


def require(value, message):
    if not value:
        raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def decode_notifications(value):
    """Typed mirror of WorkspaceNotificationState.decode; never writes native state."""
    keys = {"enabled", "muted", "unreadCompletions", "deliveryUncertain",
            "seenDecisions", "cutoff", "frontier", "receipts"}
    require(type(value) is dict and set(value) <= keys, "native notification keys")
    require({"enabled", "receipts"} <= set(value), "native required fields")
    require(len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) <= 256 * 1024,
            "native encoded bound")
    for key in ("enabled", "muted", "deliveryUncertain"):
        require(type(value.get(key, False)) is bool, "native boolean")
    count = value.get("unreadCompletions", 0)
    require(type(count) is int and 0 <= count <= 2**64 - 1, "native UInt64")
    def identifier(v, limit):
        return (type(v) is str and 0 < len(v.encode()) <= limit and
                not any(unicodedata.category(c) in ("Cc", "Cf") for c in v))
    for key in ("cutoff", "frontier"):
        require(value.get(key) is None or identifier(value[key], 2048), "native cursor")
    require(not value["enabled"] or (value.get("cutoff") is not None and value.get("frontier") is not None),
            "enabled native state lacks frontier")
    seen = value.get("seenDecisions", [])
    require(type(seen) is list and len(seen) <= 1024 and
            all(type(x) is str and re.fullmatch(r"[0-9a-f]{64}", x) for x in seen) and
            len(set(seen)) == len(seen), "native seen decisions")
    receipts = value["receipts"]
    require(type(receipts) is list and len(receipts) <= 64, "native receipt bound")
    occurrences = []
    for row in receipts:
        require(type(row) is dict and set(row) == {"occurrence", "session", "cursor", "phase"},
                "native receipt shape")
        require(identifier(row["occurrence"], 512) and identifier(row["session"], 512) and
                identifier(row["cursor"], 2048) and row["phase"] in ("reserved", "scheduled"),
                "native receipt fields")
        occurrences.append(row["occurrence"])
    require(len(set(occurrences)) == len(occurrences), "native duplicate occurrence")
    return value


def decode_checkpoint(raw, profile, binding, a, b, text, *, expected_native=None):
    require(len(raw) <= LIMIT, "checkpoint exceeds production bound")
    require(re.fullmatch(r"[0-9a-f]{64}", profile), "invalid actual profile")
    require(set(binding) == set(FIELDS), "partial/foreign binding fields")
    require(all(type(binding[k]) is str and 0 < len(binding[k]) <= 4096 for k in FIELDS),
            "invalid binding")
    require(binding == dict(owner="desktop-" + profile, profile=profile, organization="local",
                            host="local", store=profile, track="dev"), "foreign native binding")
    require(a != b and a and b and text, "invalid synthetic case plan")
    saved = json.loads(raw, object_pairs_hook=unique)
    require(type(saved) is dict and type(saved.get("version")) is int and
            saved["version"] in (1, 2), "checkpoint version")
    version = saved["version"]
    require(set(saved) == ({"version", "profile", "values"} if version == 1 else
                          {"version", "profile", "values", "native"}), "foreign checkpoint envelope")
    native = None
    if version == 2:
        require(type(saved["native"]) is dict and set(saved["native"]) == {"notifications"},
                "native section")
        native = decode_notifications(saved["native"]["notifications"])
    # Caller must supply the observed typed baseline for v2; absence is v1/default off.
    def semantics(value):
        if value is None: return None
        value = decode_notifications(value)
        return dict(enabled=value["enabled"], muted=value.get("muted", False),
                    unreadCompletions=value.get("unreadCompletions", 0),
                    deliveryUncertain=value.get("deliveryUncertain", False),
                    seenDecisions=value.get("seenDecisions", []), cutoff=value.get("cutoff"),
                    frontier=value.get("frontier"), receipts=value["receipts"])
    require(semantics(native) == semantics(expected_native), "native notification state changed/unpinned")
    require(saved["profile"] == profile, "foreign checkpoint profile")
    groups = saved["values"]
    require(type(groups) is dict and set(groups) == {"preferences", "drafts"}, "namespaces")
    preferences = groups["preferences"]
    require(type(preferences) is dict and len(preferences) <= 256, "preferences")
    require(all(type(k) is str and type(v) is str for k, v in preferences.items()), "preference types")
    allowed = {"nac-panel-list-width", "nac-thread-log-height-ratio", "nac.last-light-model",
               "nac.chatTabs", "nac.sessionNavigation", "nac.sidebar.open"}
    require(all(len(k.encode()) <= 512 and (k in allowed or k.startswith("nac.rightSidebar.collapsed."))
                for k in preferences), "foreign preference key")
    require(preferences.get("nac.sidebar.open") == "0", "sidebar preference not closed")
    key = "nac:prompt-drafts:v2:" + json.dumps([binding[k] for k in FIELDS],
                                             separators=(",", ":"), ensure_ascii=False)
    require(type(groups["drafts"]) is dict and set(groups["drafts"]) == {key}, "foreign draft bucket")
    encoded = groups["drafts"][key]
    require(type(encoded) is str and len(encoded.encode()) <= 4 * 1024 * 1024, "draft bound")
    draft = json.loads(encoded, object_pairs_hook=unique)
    require(set(draft) in ({"version", "binding", "drafts"},
                           {"version", "binding", "drafts", "recoveries"}), "intent/extra fields")
    require(type(draft["version"]) is int and draft["version"] == 2, "draft version")
    require(draft["binding"] == [binding[k] for k in FIELDS], "draft binding")
    require(draft["drafts"] == [[a, text]], "A not exact or B clear/extra text retained")
    require(draft.get("recoveries", []) == [], "unexpected submitted recovery")
    return {"version": version, "nativeNotifications": native,
            "notificationEnabled": False if native is None else native["enabled"],
            "profile": profile, "sidebarClosed": True, "exactA": True, "clearedB": True,
            "checkpointSHA256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "durabilityProvenByRead": False}


def observe(root, pinned_root, profile, binding, a, b, text, *, expected_native=None):
    """Caller owns root/home; pinned_root is the original (st_dev, st_ino).

    Every opened directory/file is no-follow, UID-bound, bookended, and closed.
    Replacement/ongoing writes fail this one observation; caller owns any wait.
    """
    root = Path(root)
    require(root.is_absolute() and root.name.startswith("nac-all349-q1-"), "fixture root")
    require(root == root.resolve(strict=True), "root alias/symlink")
    require(re.fullmatch(r"[0-9a-f]{64}", profile), "profile path")
    opened, links = [], []
    try:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        opened.append(fd)
        initial = os.fstat(fd)
        require((initial.st_dev, initial.st_ino) == tuple(pinned_root), "replaced root")
        require(initial.st_uid == os.getuid() and not initial.st_mode & 0o077, "root owner/mode")
        for name in ("home", "Library", "Application Support", "NAC", "Presentation", "dev", profile):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                            dir_fd=fd)
            opened.append(child)
            st = os.fstat(child)
            require(st.st_uid == os.getuid() and not st.st_mode & 0o077, "directory owner/mode")
            links.append((fd, name, st.st_dev, st.st_ino))
            fd = child
        filefd = os.open("checkpoint.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
        opened.append(filefd)
        first = os.fstat(filefd)
        require(stat.S_ISREG(first.st_mode) and first.st_nlink == 1, "checkpoint file type/links")
        require(first.st_uid == os.getuid() and not first.st_mode & 0o077, "checkpoint owner/mode")
        require(0 <= first.st_size <= LIMIT, "checkpoint file size")
        chunks, total = [], 0
        while True:
            part = os.read(filefd, min(65536, LIMIT + 1 - total))
            if not part:
                break
            chunks.append(part)
            total += len(part)
            require(total <= LIMIT, "checkpoint grew beyond limit")
        last = os.fstat(filefd)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
        require(all(getattr(first, k) == getattr(last, k) for k in fields), "checkpoint changed")
        current = os.stat("checkpoint.json", dir_fd=fd, follow_symlinks=False)
        require((current.st_dev, current.st_ino) == (first.st_dev, first.st_ino), "checkpoint replaced")
        for parent, name, dev, ino in links:
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == (dev, ino),
                    "directory replaced")
        current = root.lstat()
        require(stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == tuple(pinned_root),
                "root replaced during read")
        result = decode_checkpoint(b"".join(chunks), profile, binding, a, b, text, expected_native=expected_native)
        return dict(result, device=first.st_dev, inode=first.st_ino, uid=first.st_uid,
                    mode=oct(stat.S_IMODE(first.st_mode)))
    finally:
        for fd in reversed(opened):
            os.close(fd)
