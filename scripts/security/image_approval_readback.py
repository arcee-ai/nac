"""Read exact image-approval bytes at one current, pinned GitHub commit.

This is inert preparation for a protected replay. The branch protection bit
does not authenticate reviewers, ruleset settings, or a status-publishing App.
No live workflow calls this module or treats its result as clearance.
"""

import base64
from dataclasses import dataclass
import datetime as dt
import hashlib
import re
import subprocess

import image_applicability as applicability
import image_applicability_gate as gate
import image_approval_intake as intake


REPOSITORY_ID = 1194218201
BRANCH = "security-image-approvals"
MAX_RESPONSE = 24 * 1024 * 1024
MAX_TREE_ENTRIES = 8192
MAX_EVIDENCE_FILES = 1024
GIT_SHA = re.compile(r"[0-9a-f]{40}\Z")


def fetch_json(endpoint):
    """Bound one fixed-repository GitHub API response before JSON parsing."""
    process = subprocess.Popen(["gh", "api", endpoint], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL)
    try:
        raw = process.stdout.read(MAX_RESPONSE + 1)
        intake.require(len(raw) <= MAX_RESPONSE, "approval API response exceeds bound")
        intake.require(process.wait() == 0, "approval API request failed")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    value = intake.parse_json(raw)
    intake.require(type(value) is dict, "approval API response is not an object")
    return value


def current_ref(api):
    repository = api(f"repos/{intake.REPOSITORY}")
    branch = api(f"repos/{intake.REPOSITORY}/branches/{BRANCH}")
    ref = api(f"repos/{intake.REPOSITORY}/git/ref/heads/{BRANCH}")
    obj = ref.get("object")
    sha = obj.get("sha") if type(obj) is dict else None
    intake.require(repository.get("id") == REPOSITORY_ID and
                   repository.get("full_name") == intake.REPOSITORY and
                   branch.get("name") == BRANCH and branch.get("protected") is True and
                   type(branch.get("commit")) is dict and branch["commit"].get("sha") == sha and
                   ref.get("ref") == intake.APPROVAL_BRANCH and
                   type(obj) is dict and obj.get("type") == "commit" and
                   isinstance(sha, str) and GIT_SHA.fullmatch(sha),
                   "approval repository, protected branch or current ref differs")
    return sha


def pinned_tree(api, revision):
    commit = api(f"repos/{intake.REPOSITORY}/git/commits/{revision}")
    tree = commit.get("tree")
    sha = tree.get("sha") if type(tree) is dict else None
    intake.require(commit.get("sha") == revision and isinstance(sha, str) and
                   GIT_SHA.fullmatch(sha), "approval commit tree differs")
    response = api(f"repos/{intake.REPOSITORY}/git/trees/{sha}?recursive=1")
    rows = response.get("tree")
    intake.require(response.get("sha") == sha and response.get("truncated") is False and
                   type(rows) is list and len(rows) <= MAX_TREE_ENTRIES,
                   "approval tree differs or is truncated")
    entries = {}
    for row in rows:
        path = row.get("path") if type(row) is dict else None
        intake.require(isinstance(path, str) and path not in entries,
                       "invalid or duplicate approval tree path")
        entries[path] = row
    return entries


def pinned_blob(api, entries, path, maximum):
    """Reject Contents API symlink following; fetch a regular Git blob by ID."""
    item = entries.get(path)
    intake.require(type(item) is dict and item.get("type") == "blob" and
                   item.get("mode") == "100644" and
                   type(item.get("size")) is int and 0 < item["size"] <= maximum and
                   isinstance(item.get("sha"), str) and GIT_SHA.fullmatch(item["sha"]),
                   "approval file mode or size differs")
    blob = api(f"repos/{intake.REPOSITORY}/git/blobs/{item['sha']}")
    encoded = blob.get("content")
    intake.require(blob.get("sha") == item["sha"] and blob.get("size") == item["size"] and
                   blob.get("encoding") == "base64" and isinstance(encoded, str),
                   "approval blob identity differs")
    try:
        raw = base64.b64decode(encoded.replace("\n", ""), validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise intake.ApprovalError("invalid approval blob encoding") from error
    git_hash = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    intake.require(len(raw) == item["size"] and git_hash == item["sha"],
                   "approval Git blob bytes differ")
    return raw


def directory(pull_request, merge_sha, image):
    intake.positive_int(pull_request, "pull request")
    intake.hex_sha(merge_sha, "merge SHA")
    intake.digest(image, "image ID")
    return f"images/{pull_request}/{merge_sha}/{image.removeprefix('sha256:')}"


@dataclass(frozen=True)
class Snapshot:
    branch_revision: str
    record: bytes
    policy: bytes
    evidence: tuple[tuple[str, bytes], ...]


def read_current(pull_request, merge_sha, image, *, now, api=fetch_json):
    """Read an active exact-image record and its complete digest-named closure."""
    intake.require(isinstance(now, dt.datetime) and now.tzinfo is not None and
                   now.utcoffset() == dt.timedelta(), "UTC clock required")
    root = directory(pull_request, merge_sha, image)
    revision = current_ref(api)
    entries = pinned_tree(api, revision)
    record_bytes = pinned_blob(api, entries, f"{root}/record.json", 64 * 1024)
    policy_bytes = pinned_blob(api, entries, f"{root}/policy.json", gate.MAX_POLICY)
    record = intake.validate_record(record_bytes, policy_bytes, now=now)
    intake.require(record["pull_request"] == pull_request and
                   record["merge_sha"] == merge_sha and record["image"] == image,
                   "approval record differs from selected image/PR")
    policy = applicability.policy(policy_bytes, now)
    intake.require(bool(policy["rules"]) and all(
        bound["image"] == image and bound["source_revision"] == merge_sha
        for rule in policy["rules"] for bound in applicability.rule_bindings(rule)),
        "reviewed policy differs from selected image/source")
    evidence = {}
    total = 0

    def add(name):
        nonlocal total
        applicability.sha(name, "reviewed evidence")
        if name not in evidence:
            intake.require(len(evidence) < MAX_EVIDENCE_FILES,
                           "reviewed evidence file count exceeds bound")
            raw = pinned_blob(api, entries, f"{root}/evidence/{name}", gate.MAX_ARTIFACT)
            total += len(raw)
            intake.require(total <= gate.MAX_EVIDENCE and applicability.digest(raw) == name,
                           "reviewed evidence bytes exceed bound or differ")
            evidence[name] = raw
        return evidence[name]

    for rule in policy["rules"]:
        proof = applicability.document(add(rule["evidence_sha256"]), "reviewed evidence")
        artifacts = proof.get("artifacts") if type(proof) is dict else None
        intake.require(type(artifacts) is dict and artifacts,
                       "reviewed evidence artifact list is invalid")
        for name in artifacts.values():
            add(name)
    prefix = f"{root}/evidence/"
    selected_paths = {path for path in entries if path.startswith(prefix)}
    intake.require(selected_paths == {prefix + name for name in evidence},
                   "reviewed evidence tree member set differs")
    intake.require(current_ref(api) == revision, "approval branch moved during readback")
    return Snapshot(revision, record_bytes, policy_bytes, tuple(sorted(evidence.items())))


def recheck_current(snapshot, pull_request, merge_sha, image, *, now, api=fetch_json):
    """A later writer must first prove the live branch and bytes are unchanged."""
    intake.require(isinstance(snapshot, Snapshot), "prior approval snapshot required")
    current = read_current(pull_request, merge_sha, image, now=now, api=api)
    intake.require(current == snapshot, "approval changed or was revoked since readback")
    return current
