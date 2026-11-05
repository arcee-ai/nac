"""Fail-full metadata admission. Execute ONLY from the immutable trusted PR base.

This owner is not wired into Stable yet. A PURE selection is not a quality verdict.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

REPOSITORY = "arcee-ai/nac"
REPOSITORY_ID = 1194218201
WORKFLOW = ".github/workflows/stable-release.yml"
OWNER = ".github/scripts/ci-admission.py"
CONTEXT_KEYS = {"event_name", "run_id", "run_attempt", "candidate_sha", "policy_sha", "workflow_sha", "managed_applicable"}
AUTHORITY = [OWNER, ".github/scripts/ci-admission-contract.json", ".github/scripts/cold-caches.py", ".github/scripts/pr-checks.mjs",
             ".github/scripts/publication-policy.mjs"]
MARKER = "<!-- nac-ci-cold-caches -->"
CONTEXTS = ["Required PR checks", "source-security / Full locked source scan",
            "macos-native / ARM macOS process and credentials"]
FULL = "NAC full admission v1 "
PURE = "NAC metadata observation v1 "
MAX_BYTES = 4 * 1024**2


class Unknown(Exception):
    """A fixed diagnostic code, never untrusted payload text."""


def require(condition, reason):
    if not condition:
        raise Unknown(reason)


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}", value), "noncanonical_sha")
    return value


def integer(value):
    require(type(value) is int and value > 0, "noncanonical_integer")
    return value


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def cold(body):
    require(body is None or isinstance(body, str), "malformed_body")
    return body is not None and (body == MARKER or body.startswith(MARKER + "\n")
                                 or body.startswith(MARKER + "\r\n"))


def stamp(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value),
            "noncanonical_timestamp")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


class Git:
    def __init__(self, root):
        self.root = root

    def call(self, *args):
        result = subprocess.run(["git", "--no-replace-objects", "-C", str(self.root), *args],
                                check=True, capture_output=True, timeout=10,
                                env={**os.environ, "GIT_NO_LAZY_FETCH": "1",
                                     "GIT_NO_REPLACE_OBJECTS": "1", "GIT_GRAFT_FILE": os.devnull})
        require(len(result.stdout) <= 2 * 1024**2, "oversized_git_evidence")
        return result.stdout

    def blob(self, revision, path):
        return self.call("show", sha(revision) + ":" + path)

    def workflows(self, revision):
        rows = self.call("ls-tree", "-r", "--name-only", sha(revision), ".github/workflows").decode().splitlines()
        require(rows and all(re.fullmatch(r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml", p)
                             for p in rows), "unsupported_workflow_path")
        return sorted(rows)

    def current(self):
        return sha(self.call("rev-parse", "HEAD").decode().strip())

    def identity(self, revision):
        parts = self.call("show", "-s", "--format=%T %P", sha(revision)).decode().strip().split()
        require(parts, "missing_commit")
        return sha(parts[0]), [sha(value) for value in parts[1:]]


def tuple_for(event, context, git, executed_owner):
    require(set(context) == CONTEXT_KEYS, "unknown_context_fields")
    require(context.get("event_name") == "pull_request", "not_pr")
    require(context.get("run_attempt") == 1 and type(context["run_attempt"]) is int, "not_first_attempt")
    integer(context.get("run_id"))
    repository = event.get("repository", {})
    require(repository.get("id") == REPOSITORY_ID and repository.get("full_name") == REPOSITORY,
            "foreign_repository")
    request = event.get("pull_request", {})
    number = integer(event.get("number"))
    require(integer(request.get("number")) == number, "pr_number_mismatch")
    head, base = request.get("head", {}), request.get("base", {})
    require(base.get("repo", {}).get("id") == REPOSITORY_ID
            and base.get("repo", {}).get("full_name") == REPOSITORY, "foreign_base")
    head_id = integer(head.get("repo", {}).get("id"))
    head_sha, base_sha, prepared = sha(head.get("sha")), sha(base.get("sha")), sha(context.get("candidate_sha"))
    require(isinstance(base.get("ref"), str) and isinstance(head.get("ref"), str)
            and 0 < len(base["ref"]) <= 255 and 0 < len(head["ref"]) <= 255, "missing_ref")
    tree, parents = git.identity(prepared)
    # Direct-head, squash and unknown preparation remain FULL; never infer merge identity.
    require(parents == [base_sha, head_sha], "unsupported_prepared_identity")
    require(git.current() == prepared, "checkout_candidate_mismatch")
    require(context.get("policy_sha") == base_sha and context.get("workflow_sha") == prepared,
            "policy_or_workflow_identity")
    require(type(context.get("managed_applicable")) is bool, "missing_applicability")
    workflows = git.workflows(base_sha)
    require(WORKFLOW in workflows and workflows == git.workflows(head_sha)
            and workflows == git.workflows(prepared), "workflow_inventory_changed")
    paths = sorted(workflows + AUTHORITY)
    hashes = []
    for path in paths:
        trusted = git.blob(base_sha, path)
        require(git.blob(head_sha, path) == trusted and git.blob(prepared, path) == trusted,
                "untrusted_program_or_workflow")
        if path == OWNER:
            require(executed_owner == trusted, "owner_not_executed_from_trusted_base")
        hashes.append([path, hashlib.sha256(trusted).hexdigest()])
    authority = hashlib.sha256(json.dumps(hashes, separators=(",", ":")).encode()).hexdigest()
    values = [1, REPOSITORY_ID, REPOSITORY, number, head_id, head_sha, REPOSITORY_ID,
              base["ref"], base_sha, prepared, tree, base_sha, WORKFLOW, prepared, authority,
              cold(request.get("body")), context["managed_applicable"]]
    digest = hashlib.sha256(json.dumps(values, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    return {"values": values, "digest": digest, "head_ref": head["ref"], "head_id": head_id,
            "head_sha": head_sha, "candidate_sha": prepared}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Unknown("public_redirect")


class PublicReader:
    """Bounded anonymous reads, no retries, proxy credentials, or redirects."""
    def __init__(self):
        self.deadline = time.monotonic() + 30
        self.requests = 0
        self.bytes = 0
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, path, query=None):
        require(self.requests < 11 and time.monotonic() < self.deadline, "history_request_budget")
        require(re.fullmatch(r"repos/arcee-ai/nac/actions/[A-Za-z0-9_./-]+", path), "public_endpoint")
        self.requests += 1
        url = "https://api.github.com/" + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                    "User-Agent": "nac-ci-admission-v1", "X-GitHub-Api-Version": "2026-03-10"})
        with self.opener.open(request, timeout=min(8, self.deadline - time.monotonic())) as response:
            raw = response.read(min(512 * 1024, MAX_BYTES - self.bytes) + 1)
            self.bytes += len(raw)
            require(response.status == 200 and len(raw) <= 512 * 1024 and self.bytes <= MAX_BYTES,
                    "history_byte_budget")
        return json.loads(raw, object_pairs_hook=unique)


def rows(value, key):
    require(isinstance(value, dict), "malformed_public_list")
    data, count = value.get(key), value.get("total_count")
    require(isinstance(data, list) and type(count) is int and count >= len(data)
            and len(data) <= 100, "incomplete_public_list")
    return data, count


def run_identity(run, identity):
    require(run.get("repository", {}).get("id") == REPOSITORY_ID
            and run.get("path") == WORKFLOW and run.get("event") == "pull_request"
            and run.get("head_branch") == identity["head_ref"]
            and run.get("head_repository", {}).get("id") == identity["head_id"], "foreign_history")
    integer(run.get("id"))
    require(type(run.get("run_attempt")) is int and run["run_attempt"] == 1, "history_retry_unknown")


def marker_for(run, identity, read):
    run_identity(run, identity)
    require(run.get("head_sha") == identity["head_sha"], "intervening_head_change")
    run_id = run["id"]
    jobs, count = rows(read(f"repos/{REPOSITORY}/actions/runs/{run_id}/attempts/1/jobs",
                            {"per_page": 100}), "jobs")
    require(count == len(jobs), "incomplete_attempt_jobs")
    markers = [j for j in jobs if isinstance(j.get("name"), str)
               and (j["name"].startswith(FULL) or j["name"].startswith(PURE))]
    require(len(markers) == 1, "unknown_or_multiple_admission")
    marker = markers[0]
    require(marker.get("run_id") == run_id and marker.get("head_sha") == identity["head_sha"]
            and marker.get("started_at") is not None, "unbound_admission")
    stamp(marker["started_at"])
    integer(marker.get("id"))
    name = marker["name"]
    require(name in [FULL + identity["digest"], PURE + identity["digest"]], "changed_admission_tuple")
    # No status/conclusion, quality receipt, actor or output is read as authority.
    return "full" if name.startswith(FULL) else "pure"


def latest_admission(context, identity, read):
    current = read(f"repos/{REPOSITORY}/actions/runs/{context['run_id']}")
    run_identity(current, identity)
    require(current["id"] == context["run_id"] and current.get("head_sha") == identity["head_sha"],
            "current_run_identity")
    workflow = integer(current.get("workflow_id"))
    current_time = stamp(current.get("created_at"))
    seen_ids, seen_current, previous_time, checked = set(), False, None, 0
    first_total = None
    for page in [1, 2]:
        runs, total = rows(read(f"repos/{REPOSITORY}/actions/workflows/{workflow}/runs",
                               {"branch": identity["head_ref"], "event": "pull_request",
                                "per_page": 100, "page": page}), "workflow_runs")
        if first_total is None:
            first_total = total
        require(total == first_total and len(runs) == min(100, max(total - (page - 1) * 100, 0)),
                "incomplete_or_moving_history_page")
        page_ids = [integer(run.get("id")) for run in runs]
        page_times = [stamp(run.get("created_at")) for run in runs]
        require(len(set(page_ids)) == len(page_ids) and page_times == sorted(page_times, reverse=True),
                "malformed_history_page")
        for run in runs:
            require(run.get("workflow_id") == workflow, "foreign_history_workflow")
            run_id = integer(run.get("id"))
            created = stamp(run.get("created_at"))
            require(run_id not in seen_ids and (previous_time is None or created <= previous_time),
                    "history_overlap_or_order")
            seen_ids.add(run_id)
            previous_time = created
            # Newer runs cannot attest this original event. Same-second ambiguity is FULL.
            if run_id == context["run_id"]:
                require(created == current_time, "current_history_time")
                seen_current = True
                continue
            if created > current_time:
                continue
            require(created != current_time, "ambiguous_event_order")
            require(seen_current, "current_run_missing_from_interval")
            run_identity(run, identity)
            checked += 1
            require(checked <= 8, "history_marker_budget")
            kind = marker_for(run, identity, read)
            if kind == "full":
                return {"run_id": run_id, "attempt": 1, "tuple_digest": identity["digest"]}
        if page * 100 >= total:
            break
        require(len(runs) == 100, "incomplete_history_page")
    raise Unknown("no_complete_latest_admission")


def full(reason, context):
    candidate = context.get("candidate_sha")
    return {"schema_version": 1, "mode": "full", "reason": reason,
            "candidate_sha": candidate if isinstance(candidate, str) and re.fullmatch(r"[a-f0-9]{40}", candidate) else None,
            "quality_reused": False, "required_source_contexts": CONTEXTS,
            "consumer": {"selection": "current_full_run", "cross_run_quality_reuse": False}}


def select(event, context, git, read, executed_owner):
    """Only exact positive PURE narrows work. All unknown evidence returns FULL."""
    identity = None
    try:
        require(isinstance(event, dict) and isinstance(context, dict), "malformed_input")
        require(context.get("event_name") == "pull_request", "not_pr")
        require(event.get("action") == "edited", "mandatory_source_event")
        changes = event.get("changes")
        require(isinstance(changes, dict) and changes and set(changes) <= {"body", "title"},
                "not_pure_edit_fields")
        for field, change in changes.items():
            require(isinstance(change, dict) and set(change) == {"from"}, "unknown_edit_shape")
            old = change["from"]
            require(old is None or isinstance(old, str), "malformed_previous_edit")
            if field == "body":
                require(cold(old) == cold(event.get("pull_request", {}).get("body")), "cold_transition")
        identity = tuple_for(event, context, git, executed_owner)
        admission = latest_admission(context, identity, read)
        return {"schema_version": 1, "mode": "pure", "reason": "proven_metadata_only",
                "candidate_sha": identity["candidate_sha"], "tuple_digest": identity["digest"],
                "quality_reused": False, "required_source_contexts": [], "admission": admission,
                "consumer": {"selection": "bound_latest_full_run", "run_id": admission["run_id"],
                             "attempt": 1, "tuple_digest": identity["digest"],
                             "cross_run_quality_reuse": False}}
    except (Unknown, OSError, ValueError, TypeError, KeyError, AttributeError,
            subprocess.SubprocessError, UnicodeError):
        import sys
        error = sys.exc_info()[1]
        reason = str(error) if isinstance(error, Unknown) else "unavailable_or_malformed_evidence"
        result = full(reason, context if isinstance(context, dict) else {})
        # FULL work can publish a selection marker only if its identity is independently
        # canonical/trusted. Unknown preparation still runs FULL without any marker.
        if identity is None and isinstance(event, dict) and isinstance(context, dict):
            try:
                identity = tuple_for(event, context, git, executed_owner)
            except (Unknown, OSError, ValueError, TypeError, KeyError, AttributeError,
                    subprocess.SubprocessError, UnicodeError):
                pass
        if identity is not None:
            result["tuple_digest"] = identity["digest"]
        return result


def read_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), "nonregular_input")
        raw = source.read(8 * 1024**2 + 1)
    require(len(raw) <= 8 * 1024**2, "oversized_input")
    return json.loads(raw, object_pairs_hook=unique)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True, type=Path)
    parser.add_argument("--context", required=True, type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    args = parser.parse_args()
    context = {}
    try:
        context = read_json(args.context)
        result = select(read_json(args.event), context, Git(args.repository), PublicReader(), Path(__file__).read_bytes())
    except (Unknown, OSError, ValueError, TypeError):
        result = full("unavailable_or_malformed_input", context if isinstance(context, dict) else {})
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
