"""Inactive approval-plane authority checks for a future protected replay job.

All authority anchors are intentionally unset. A protected maintainer must
review and pin them after the dedicated rulesets, CODEOWNERS and workflow land.
No workflow invokes this module, and it never publishes a status.
"""

from dataclasses import dataclass
import datetime as dt
import os
from pathlib import Path
import re
import subprocess

import image_approval_intake as intake
import image_approval_readback as readback
import image_approval_source as source


ROOT = Path(__file__).resolve().parents[2]
MAX_RESPONSE = 24 * 1024 * 1024
CODEOWNERS = ".github/CODEOWNERS"


@dataclass(frozen=True)
class AuthorityPins:
    trusted_dev_revision: str | None = None
    dev_ruleset_id: int | None = None
    approval_ruleset_id: int | None = None
    reviewer_id: int | None = None
    reviewer_login: str | None = None
    codeowners_blob: str | None = None
    workflow_path: str | None = None
    workflow_blob: str | None = None


def _github_time(value):
    intake.require(isinstance(value, str) and len(value) <= 40,
                   "missing GitHub authority timestamp")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise intake.ApprovalError("invalid GitHub authority timestamp") from error
    intake.require(parsed.tzinfo is not None and parsed.utcoffset() is not None,
                   "GitHub authority timestamp has no timezone")
    return parsed


def configured(pins):
    intake.require(isinstance(pins, AuthorityPins), "authority pins are required")
    intake.hex_sha(pins.trusted_dev_revision, "trusted dev revision")
    intake.positive_int(pins.dev_ruleset_id, "dev ruleset ID")
    intake.positive_int(pins.approval_ruleset_id, "approval ruleset ID")
    intake.require(pins.dev_ruleset_id != pins.approval_ruleset_id,
                   "dev and approval rulesets must be separate")
    intake.positive_int(pins.reviewer_id, "security reviewer ID")
    intake.require(isinstance(pins.reviewer_login, str) and
                   re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})", pins.reviewer_login),
                   "security reviewer login is unset or invalid")
    intake.hex_sha(pins.codeowners_blob, "CODEOWNERS blob")
    intake.require(isinstance(pins.workflow_path, str) and
                   re.fullmatch(r"\.github/workflows/[A-Za-z0-9_-]+\.ya?ml", pins.workflow_path),
                   "protected workflow path is unset or invalid")
    intake.hex_sha(pins.workflow_blob, "protected workflow blob")
    return pins


def fetch_list(endpoint):
    """Bound a fixed-repository GitHub list response; never accept pagination overflow."""
    process = subprocess.Popen(["gh", "api", endpoint], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL)
    try:
        raw = process.stdout.read(MAX_RESPONSE + 1)
        intake.require(len(raw) <= MAX_RESPONSE, "authority API response exceeds bound")
        intake.require(process.wait() == 0, "authority API request failed")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    value = intake.parse_json(raw)
    intake.require(type(value) is list, "authority API response is not a list")
    return value


def _ruleset(api, rule_id, branch):
    value = api(f"repos/{intake.REPOSITORY}/rulesets/{rule_id}")
    conditions = value.get("conditions")
    names = conditions.get("ref_name") if type(conditions) is dict else None
    rows = value.get("rules")
    intake.require(value.get("id") == rule_id and value.get("target") == "branch" and
                   value.get("source_type") == "Repository" and
                   value.get("source") == intake.REPOSITORY and
                   value.get("enforcement") == "active" and
                   value.get("bypass_actors") == [] and
                   type(names) is dict and
                   names.get("include") == [f"refs/heads/{branch}"] and
                   names.get("exclude") == [] and type(rows) is list,
                   "protected branch ruleset identity, exact ref or bypass differs")
    indexed = {}
    for row in rows:
        kind = row.get("type") if type(row) is dict else None
        intake.require(isinstance(kind, str) and kind not in indexed,
                       "duplicate or malformed protected branch rule")
        indexed[kind] = row
    intake.require({"deletion", "non_fast_forward", "pull_request"} <= set(indexed),
                   "protected branch lacks PR-only or mutation rules")
    intake.require(_github_time(value.get("created_at")) <=
                   _github_time(value.get("updated_at")),
                   "protected branch ruleset dates differ")
    parameters = indexed["pull_request"].get("parameters")
    intake.require(type(parameters) is dict and
                   parameters.get("allowed_merge_methods") == ["squash"] and
                   parameters.get("dismiss_stale_reviews_on_push") is True and
                   parameters.get("require_code_owner_review") is True and
                   parameters.get("require_last_push_approval") is True and
                   parameters.get("required_review_thread_resolution") is True and
                   type(parameters.get("required_approving_review_count")) is int and
                   parameters["required_approving_review_count"] >= 1,
                   "protected branch reviewer or squash discipline differs")
    return value


def _current_branches(snapshot, pins, api):
    intake.require(readback.current_ref(api) == snapshot.branch_revision,
                   "approval branch moved before authority check")
    intake.require(source.current_trusted_ref(api) == pins.trusted_dev_revision,
                   "protected dev revision moved")
    repository = api(f"repos/{intake.REPOSITORY}")
    intake.require(repository.get("id") == readback.REPOSITORY_ID and
                   repository.get("full_name") == intake.REPOSITORY and
                   repository.get("default_branch") == source.TRUSTED_BRANCH,
                   "authority repository/default branch differs")


def _pinned_files(snapshot, pins, api):
    approval_tree = readback.pinned_tree(api, snapshot.branch_revision)
    item = approval_tree.get(CODEOWNERS)
    intake.require(type(item) is dict and item.get("sha") == pins.codeowners_blob,
                   "approval CODEOWNERS blob is not the reviewed pin")
    owners = readback.pinned_blob(api, approval_tree, CODEOWNERS, 64 * 1024)
    intake.require(owners == f"* @{pins.reviewer_login}\n".encode(),
                   "approval CODEOWNERS does not exclusively cover every path")
    dev_tree = readback.pinned_tree(api, pins.trusted_dev_revision)
    workflow = dev_tree.get(pins.workflow_path)
    intake.require(type(workflow) is dict and workflow.get("sha") == pins.workflow_blob,
                   "protected workflow blob is not the reviewed pin")
    readback.pinned_blob(api, dev_tree, pins.workflow_path, 1024 * 1024)


def _reviewed_commit(snapshot, record, pins, approval_ruleset, api, list_api):
    root = readback.directory(record["pull_request"], record["merge_sha"], record["image"])
    paths = [f"{root}/record.json", f"{root}/policy.json"]
    paths.extend(f"{root}/evidence/{name}" for name, _ in snapshot.evidence)
    commit_sha = None
    for path in paths:
        endpoint = (f"repos/{intake.REPOSITORY}/commits?sha={snapshot.branch_revision}"
                    f"&path={path}&per_page=1")
        commits = list_api(endpoint)
        intake.require(len(commits) == 1 and type(commits[0]) is dict,
                       "approval closure path has no reviewed history")
        value = intake.hex_sha(commits[0].get("sha"), "approval closure commit")
        if commit_sha is None:
            commit_sha = value
        intake.require(value == commit_sha,
                       "approval record, policy and evidence were not reviewed together")
    pull_requests = list_api(f"repos/{intake.REPOSITORY}/commits/{commit_sha}/pulls?per_page=2")
    intake.require(len(pull_requests) == 1 and type(pull_requests[0]) is dict,
                   "approval commit has no unique merged pull request")
    pr = pull_requests[0]
    base = pr.get("base") if type(pr.get("base")) is dict else {}
    author = pr.get("user") if type(pr.get("user")) is dict else {}
    head = pr.get("head") if type(pr.get("head")) is dict else {}
    head_user = head.get("user") if type(head.get("user")) is dict else {}
    base_repo = base.get("repo") if type(base.get("repo")) is dict else {}
    intake.require(pr.get("state") == "closed" and pr.get("merged") is True and
                   pr.get("merge_commit_sha") == commit_sha and
                   base.get("ref") == readback.BRANCH and
                   base_repo.get("id") == readback.REPOSITORY_ID and
                   type(author.get("id")) is int and author["id"] > 0 and
                   type(head_user.get("id")) is int and head_user["id"] > 0 and
                   author.get("id") != pins.reviewer_id and
                   head_user.get("id") != pins.reviewer_id and
                   type(pr.get("number")) is int and pr["number"] > 0 and
                   isinstance(head.get("sha"), str) and readback.GIT_SHA.fullmatch(head["sha"]),
                   "approval closure was not squash-merged by a separate author")
    intake.require(_github_time(approval_ruleset["updated_at"]) <=
                   _github_time(pr.get("merged_at")),
                   "approval ruleset changed after this record's review")
    merged_tree = readback.pinned_tree(api, commit_sha)
    owners = merged_tree.get(CODEOWNERS)
    intake.require(type(owners) is dict and owners.get("sha") == pins.codeowners_blob and
                   readback.pinned_blob(api, merged_tree, CODEOWNERS, 64 * 1024) ==
                   f"* @{pins.reviewer_login}\n".encode(),
                   "approval PR did not merge under pinned CODEOWNERS")
    reviews = list_api(f"repos/{intake.REPOSITORY}/pulls/{pr['number']}/reviews?per_page=100")
    intake.require(len(reviews) < 100, "approval review history is truncated")
    selected = [review for review in reviews if type(review) is dict and
                type(review.get("user")) is dict and
                review["user"].get("id") == pins.reviewer_id]
    intake.require(bool(selected), "designated security reviewer did not review approval PR")
    for review in selected:
        intake.positive_int(review.get("id"), "security review ID")
        _github_time(review.get("submitted_at"))
    selected.sort(key=lambda review: (_github_time(review["submitted_at"]), review["id"]))
    latest = selected[-1]
    intake.require(latest["user"].get("login") == pins.reviewer_login and
                   latest.get("state") == "APPROVED" and
                   latest.get("commit_id") == head["sha"] and
                   _github_time(latest["submitted_at"]) <=
                   _github_time(pr.get("merged_at")),
                   "designated security review is stale, dismissed or not on final head")
    return commit_sha


def _git(root, *args):
    process = subprocess.run(["git", "-C", str(root), *args], check=True,
                             capture_output=True, text=True, timeout=15)
    return process.stdout.strip()


def _code_origin(pins, *, root, environment, git):
    intake.require(environment.get("GITHUB_REPOSITORY") == intake.REPOSITORY and
                   environment.get("GITHUB_REPOSITORY_ID") == str(readback.REPOSITORY_ID) and
                   environment.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and
                   environment.get("GITHUB_REF") == "refs/heads/dev" and
                   environment.get("GITHUB_SHA") == pins.trusted_dev_revision and
                   environment.get("GITHUB_WORKFLOW_SHA") == pins.trusted_dev_revision and
                   environment.get("GITHUB_WORKFLOW_REF") ==
                   f"{intake.REPOSITORY}/{pins.workflow_path}@refs/heads/dev",
                   "protected dev workflow event/code identity differs")
    root = Path(root)
    intake.require(root.is_dir() and not root.is_symlink() and
                   Path(__file__).is_file() and not Path(__file__).is_symlink() and
                   Path(__file__).resolve().parents[2] == root.resolve(),
                   "protected code module/root is invalid")
    intake.require(git(root, "rev-parse", "--show-toplevel") == str(root.resolve()) and
                   git(root, "rev-parse", "HEAD") == pins.trusted_dev_revision and
                   git(root, "remote", "get-url", "origin").removesuffix(".git") ==
                   f"https://github.com/{intake.REPOSITORY}" and
                   git(root, "status", "--porcelain", "--untracked-files=all") == "",
                   "protected code checkout is not exact, clean dev")


def verify(snapshot, *, pins=AuthorityPins(), now, api=readback.fetch_json,
           list_api=fetch_list, root=ROOT, environment=None, git=_git):
    """Validate this exact snapshot in this call; return no reusable authority."""
    configured(pins)
    intake.require(isinstance(snapshot, readback.Snapshot), "protected readback required")
    if environment is None:
        environment = os.environ
    _current_branches(snapshot, pins, api)
    dev_ruleset = _ruleset(api, pins.dev_ruleset_id, source.TRUSTED_BRANCH)
    approval_ruleset = _ruleset(api, pins.approval_ruleset_id, readback.BRANCH)
    _pinned_files(snapshot, pins, api)
    record = intake.validate_record(snapshot.record, snapshot.policy, now=now)
    _reviewed_commit(snapshot, record, pins, approval_ruleset, api, list_api)
    _code_origin(pins, root=root, environment=environment, git=git)
    _current_branches(snapshot, pins, api)
    intake.require(_ruleset(api, pins.dev_ruleset_id, source.TRUSTED_BRANCH) == dev_ruleset and
                   _ruleset(api, pins.approval_ruleset_id, readback.BRANCH) == approval_ruleset,
                   "protected rulesets changed during authority read")
    # The reviewed commit is intentionally not returned as a transferable
    # receipt: another image must repeat the whole per-path authority check.
