"""Fail-closed identity contract for a future trusted exact-image approval publisher.

All GitHub objects passed here must be fetched by the trusted publisher, never
read from a candidate artifact. This module deliberately grants no authority to
publish: the caller still needs a protected approval branch and a dedicated App.
"""

import datetime as dt
import hashlib
import json
import re
import urllib.error
import urllib.request


REPOSITORY = "arcee-ai/nac"
APPROVAL_BRANCH = "refs/heads/security-image-approvals"
STATUS_CONTEXT = "Managed image approval"
WORKFLOW_PATH = ".github/workflows/stable-release.yml"
BUILD_JOB_NAME = "managed-image / build-candidate"
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
BARE_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
RECORD_FIELDS = frozenset({
    "schema_version", "repository", "pull_request", "head_sha", "base_sha",
    "merge_sha", "image", "run_id", "run_attempt", "build_job_id",
    "artifact_id", "artifact_name", "artifact_digest", "approval_sha256",
    "approved_at", "expires_at", "state",
})


class ApprovalError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ApprovalError(message)


def parse_json(raw):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=unique_pairs,
                          parse_constant=lambda value: require(False, f"nonfinite {value}"))
    except (ValueError, TypeError) as error:
        raise ApprovalError(f"invalid approval JSON: {error}") from error


def timestamp(value):
    require(isinstance(value, str) and
            re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value),
            "timestamp must use UTC seconds")
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    except ValueError as error:
        raise ApprovalError("invalid approval timestamp") from error


def hex_sha(value, name):
    require(isinstance(value, str) and SHA.fullmatch(value), f"invalid {name}")
    return value


def digest(value, name):
    require(isinstance(value, str) and DIGEST.fullmatch(value), f"invalid {name}")
    return value


def positive_int(value, name):
    require(type(value) is int and value > 0, f"invalid {name}")
    return value


def validate_record(raw, policy_bytes, *, now, allow_revoked=False):
    """Validate protected-branch bytes, without pretending to authenticate them."""
    require(isinstance(policy_bytes, bytes), "reviewed approval must be exact bytes")
    record = parse_json(raw)
    require(type(record) is dict and set(record) == RECORD_FIELDS,
            "approval record fields differ from schema 1")
    require(record["schema_version"] == 1, "unsupported approval record schema")
    require(record["repository"] == REPOSITORY, "approval repository mismatch")
    positive_int(record["pull_request"], "pull request")
    for name in ("head_sha", "base_sha", "merge_sha"):
        hex_sha(record[name], name)
    digest(record["image"], "image ID")
    for name in ("run_id", "run_attempt", "build_job_id", "artifact_id"):
        positive_int(record[name], name)
    require(record["artifact_name"] == f"managed-image-candidate-{record['merge_sha']}-{record['run_id']}-{record['run_attempt']}",
            "artifact name does not bind source run and attempt")
    digest(record["artifact_digest"], "artifact digest")
    require(isinstance(record["approval_sha256"], str) and
            BARE_DIGEST.fullmatch(record["approval_sha256"]), "invalid approval digest")
    require(record["approval_sha256"] == hashlib.sha256(policy_bytes).hexdigest(),
            "reviewed approval bytes differ from protected record")
    require(record["state"] == "active" or
            (allow_revoked and record["state"] == "revoked"),
            "approval is revoked or inactive")
    approved_at, expires_at = timestamp(record["approved_at"]), timestamp(record["expires_at"])
    require(isinstance(now, dt.datetime) and now.tzinfo is not None, "UTC clock required")
    require(approved_at <= now and
            (record["state"] == "revoked" or now < expires_at),
            "approval is not current")
    require(expires_at - approved_at <= dt.timedelta(days=30), "approval exceeds 30 days")
    return record


def validate_provenance(record, *, pr, merge_ref, run, build_job, artifact,
                        downloaded_artifact_digest, approval_branch_ref,
                        record_fetched_at_sha):
    """Cross-check independently fetched GitHub API objects before replay."""
    require(approval_branch_ref.get("ref") == APPROVAL_BRANCH,
            "unexpected approval branch")
    branch_sha = hex_sha(approval_branch_ref.get("object", {}).get("sha"),
                         "approval branch SHA")
    require(record_fetched_at_sha == branch_sha,
            "approval record was not fetched from current branch head")
    require(pr.get("number") == record["pull_request"] and pr.get("state") == "open",
            "pull request identity/state changed")
    require(pr.get("head", {}).get("sha") == record["head_sha"] and
            pr.get("base", {}).get("sha") == record["base_sha"],
            "pull request head/base changed")
    require(pr.get("merge_commit_sha") == record["merge_sha"] and
            merge_ref.get("ref") == f"refs/pull/{record['pull_request']}/merge" and
            merge_ref.get("object", {}).get("sha") == record["merge_sha"],
            "live synthetic merge SHA changed")
    require(run.get("id") == record["run_id"] and
            run.get("event") == "pull_request" and
            run.get("path") == WORKFLOW_PATH and
            run.get("head_sha") == record["head_sha"] and
            positive_int(run.get("run_attempt"), "latest run attempt") >= record["run_attempt"],
            "source workflow run does not match approval")
    linked = run.get("pull_requests")
    require(isinstance(linked, list) and any(
        item.get("number") == record["pull_request"] and
        item.get("head", {}).get("sha") == record["head_sha"] and
        item.get("base", {}).get("sha") == record["base_sha"] for item in linked),
        "run is not linked to approved PR head/base")
    require(build_job.get("id") == record["build_job_id"] and
            build_job.get("run_id") == record["run_id"] and
            build_job.get("run_attempt") == record["run_attempt"] and
            build_job.get("name") == BUILD_JOB_NAME and
            build_job.get("conclusion") == "success", "build job/attempt not successful")
    require(artifact.get("id") == record["artifact_id"] and
            artifact.get("name") == record["artifact_name"] and
            artifact.get("digest") == record["artifact_digest"] and
            artifact.get("expired") is False, "artifact identity/digest/expiry changed")
    origin = artifact.get("workflow_run", {})
    require(origin.get("id") == record["run_id"] and
            origin.get("head_sha") == record["head_sha"],
            "artifact does not belong to approved workflow run/head")
    digest(downloaded_artifact_digest, "downloaded artifact digest")
    require(downloaded_artifact_digest == record["artifact_digest"],
            "downloaded artifact archive digest changed")
    created, started, completed = (timestamp(artifact.get("created_at")),
                                   timestamp(build_job.get("started_at")),
                                   timestamp(build_job.get("completed_at")))
    require(started <= created <= completed, "artifact was not uploaded in approved attempt")
    require(created <= timestamp(record["approved_at"]), "approval predates artifact")
    return branch_sha


def validate_replay(record, result, *, branch_sha_before, branch_sha_after):
    """Return a proposed App status only after strict same-byte replay passes."""
    require(branch_sha_before == branch_sha_after,
            "approval branch changed during rescan")
    require(result.get("status") == "passed" and result.get("blocking") == 0 and
            result.get("image") == record["image"] and
            result.get("applicability") == "verified" and
            isinstance(result.get("decision_sha256"), str) and
            BARE_DIGEST.fullmatch(result["decision_sha256"]),
            "strict exact-image replay did not pass")
    return {"state": "success", "context": STATUS_CONTEXT,
            "description": "Exact frozen image passed reviewed security replay",
            "sha": record["merge_sha"]}


def revocation_status(record, *, pr, merge_ref, approval_branch_ref,
                      record_fetched_at_sha):
    """Propose a failure for a current protected-branch revocation record."""
    require(record["state"] == "revoked", "record is not revoked")
    hex_sha(record_fetched_at_sha, "current approval branch SHA")
    require(approval_branch_ref.get("ref") == APPROVAL_BRANCH and
            approval_branch_ref.get("object", {}).get("sha") == record_fetched_at_sha,
            "revocation is not from current protected branch head")
    require(pr.get("number") == record["pull_request"] and
            pr.get("state") == "open" and
            pr.get("head", {}).get("sha") == record["head_sha"] and
            pr.get("base", {}).get("sha") == record["base_sha"] and
            pr.get("merge_commit_sha") == record["merge_sha"] and
            merge_ref.get("ref") == f"refs/pull/{record['pull_request']}/merge" and
            merge_ref.get("object", {}).get("sha") == record["merge_sha"],
            "revocation target changed")
    return {"state": "failure", "context": STATUS_CONTEXT,
            "description": "Exact-image approval revoked", "sha": record["merge_sha"]}


def publish_status(status, *, app_token, expected_app_bot,
                   opener=urllib.request.urlopen):
    """Publish via a dedicated App token; a failed/ambiguous response is failure."""
    require(status.get("state") in {"success", "failure"} and
            status.get("context") == STATUS_CONTEXT,
            "unexpected status publication request")
    sha = hex_sha(status.get("sha"), "status target")
    require(isinstance(app_token, str) and app_token, "dedicated App token required")
    require(isinstance(expected_app_bot, str) and
            re.fullmatch(r"[A-Za-z0-9-]+\[bot\]", expected_app_bot),
            "expected dedicated App bot required")
    url = f"https://api.github.com/repos/{REPOSITORY}/statuses/{sha}"
    body = {key: status[key] for key in ("state", "context", "description")}
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Accept": "application/vnd.github+json", "Authorization": f"Bearer {app_token}",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
    try:
        with opener(request, timeout=30) as response:
            require(response.status == 201, "status API did not create a status")
            created = parse_json(response.read())
    except (OSError, urllib.error.URLError) as error:
        raise ApprovalError("status publication failed") from error
    require(created.get("state") == status["state"] and
            created.get("context") == STATUS_CONTEXT and
            created.get("creator", {}).get("login") == expected_app_bot and
            created.get("url") == url,
            "status API response does not confirm publication")
    return created
