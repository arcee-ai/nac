"""Inert, fail-closed exact-image replay; never writes a GitHub status.

The caller must run protected code in an isolated read-only job without a
status-writing credential, supply
independently authenticated source-policy paths and download an Actions artifact
by approved ID. Branch protection's boolean alone is not reviewer/ruleset/App
authentication. No workflow calls this module yet.
"""

import datetime as dt
from pathlib import Path
import subprocess
import sys

import image_applicability as applicability
import image_applicability_bundle as bundle
import image_applicability_gate as gate
import image_approval_intake as intake
import image_approval_readback as readback
import image_approval_refresh as refresh
import image_candidate_archive as candidate
from image_inventory import sha256


ROOT = Path(__file__).resolve().parents[2]


def github_objects(record, api):
    """Fetch identity objects by exact approved IDs, not candidate metadata."""
    prefix = f"repos/{intake.REPOSITORY}"
    number = record["pull_request"]
    return {
        "pr": api(f"{prefix}/pulls/{number}"),
        "merge_ref": api(f"{prefix}/git/ref/pull/{number}/merge"),
        "run": api(f"{prefix}/actions/runs/{record['run_id']}"),
        "build_job": api(f"{prefix}/actions/jobs/{record['build_job_id']}"),
        "artifact": api(f"{prefix}/actions/artifacts/{record['artifact_id']}"),
    }


def current_observations(inventory, now):
    """No clock relabeling: an old V4 collection needs actual recollection."""
    context = bundle.read_json(inventory, bundle.CONTEXT, maximum=4 * 1024 ** 2)
    intake.require(type(context) is dict and context.get("schema_version") == 2,
                   "fresh V4 applicability context required")
    applicability.fresh(context.get("collected_at"), now,
                        applicability.MAX_EVIDENCE_AGE, "frozen observation")


def observations_stale(inventory, now):
    context = bundle.read_json(inventory, bundle.CONTEXT, maximum=4 * 1024 ** 2)
    intake.require(type(context) is dict and context.get("schema_version") == 2,
                   "complete V4 applicability context required")
    age = now - applicability.timestamp(context.get("collected_at"))
    intake.require(age >= dt.timedelta(), "future frozen observation")
    return age >= applicability.MAX_EVIDENCE_AGE


def _stage_review(snapshot, directory):
    directory.mkdir(mode=0o700)
    policy = directory / "policy.json"
    policy.write_bytes(snapshot.policy)
    evidence = directory / "evidence"
    evidence.mkdir(mode=0o700)
    for name, raw in snapshot.evidence:
        applicability.sha(name, "reviewed evidence")
        intake.require(applicability.digest(raw) == name,
                       "reviewed evidence bytes differ from snapshot")
        (evidence / name).write_bytes(raw)
    return policy, evidence


def _scan(inventory, record, output, policy, evidence, source_policy,
          candidate_policy, source_applicability, candidate_applicability,
          *, run):
    command = [sys.executable, str(ROOT / "scripts/security/image_scan.py"),
               "--bundle", str(inventory), "--image", record["image"],
               "--source-revision", record["merge_sha"], "--output", str(output),
               "--trusted-policy", str(source_policy),
               "--candidate-policy", str(candidate_policy),
               "--trusted-applicability-policy", str(source_applicability),
               "--candidate-applicability-policy", str(candidate_applicability),
               "--reviewed-image-approval", str(policy),
               "--reviewed-image-approval-sha256", record["approval_sha256"],
               "--reviewed-image-evidence", str(evidence),
               "--tool-cache", str(output.parent / "tools"),
               "--db-cache", str(output.parent / "database")]
    return run(command, check=False).returncode


def replay(pull_request, merge_sha, image, archive, workspace, *,
           source_policy, candidate_policy, source_applicability,
           candidate_applicability, api=readback.fetch_json,
           scan=subprocess.run, load=candidate.load_exact_image,
           verify=refresh.verify_frozen, recollect=refresh.recollect,
           clock=lambda: dt.datetime.now(dt.timezone.utc)):
    """Return only an unpublishable status proposal after same-byte replay.

    ``workspace`` must be an absent path in an isolated read-only job without
    a status-writing credential.
    The archive must have been downloaded by approved artifact ID. This caller
    does not fetch the archive or authenticate source-policy paths, so it must
    not be used as a status-publishing workflow without those missing controls.
    """
    now = clock()
    intake.require(isinstance(now, dt.datetime) and now.tzinfo is not None and
                   now.utcoffset() == dt.timedelta(), "UTC clock required")
    original_workspace = Path(workspace)
    workspace = original_workspace.resolve()
    intake.require(not original_workspace.exists() and
                   not original_workspace.is_symlink() and not workspace.exists(),
                   "replay workspace already exists")
    for path in (archive, source_policy, candidate_policy, source_applicability,
                 candidate_applicability):
        original = Path(path)
        selected = original.resolve()
        intake.require(original.is_file() and not original.is_symlink() and
                       selected != workspace and not selected.is_relative_to(workspace),
                       "replay input path is missing or inside output workspace")
    snapshot = readback.read_current(pull_request, merge_sha, image, now=now, api=api)
    record = intake.validate_record(snapshot.record, snapshot.policy, now=now)
    objects = github_objects(record, api)
    archive_digest = candidate._sha256_file(Path(archive), candidate.MAX_ZIP_BYTES)
    intake.validate_provenance(record, **objects,
        downloaded_artifact_digest=archive_digest,
        approval_branch_ref=api(f"repos/{intake.REPOSITORY}/git/ref/heads/{readback.BRANCH}"),
        record_fetched_at_sha=snapshot.branch_revision)
    workspace.mkdir(mode=0o700)
    image_tar, inventory = candidate.extract_candidate(
        archive, workspace / "candidate", artifact_digest=record["artifact_digest"],
        image=image, source_revision=merge_sha)
    identity = verify(inventory, workspace / "verified-frozen",
                      image=image, source_revision=merge_sha)
    stale = observations_stale(inventory, now)
    load(image_tar, image)
    if stale:
        inventory = recollect(inventory, workspace / "verified-frozen",
                              workspace / "derivative", identity,
                              image=image, source_revision=merge_sha)
    current_observations(inventory, clock())
    policy, evidence = _stage_review(snapshot, workspace / "review")
    output = workspace / "strict-scan"
    code = _scan(inventory, record, output, policy, evidence, source_policy,
                 candidate_policy, source_applicability, candidate_applicability,
                 run=scan)
    intake.require(code == 0, "strict image replay did not exit successfully")
    result = intake.parse_json((output / "result.json").read_bytes())
    findings = intake.parse_json((output / "findings.json").read_bytes())
    source_result = intake.parse_json((output / "policy-result.json").read_bytes())
    identity = {"image": image, "source_revision": merge_sha}
    decision = gate.validated_decision(output, findings, source_result, identity)
    receipt = intake.parse_json((output / "applicability-result.json").read_bytes())
    intake.require(receipt.get("status") == "verified" and
                   receipt.get("approval_mode") == "post-build" and
                   receipt.get("policy_sha256") == record["approval_sha256"] and
                   result.get("findings") == len(findings) and
                   result.get("blocking") == len(decision["blocking_indexes"]) and
                   result.get("decision_sha256") == sha256(output / "decision.json"),
                   "strict replay receipts differ from reviewed policy or raw findings")
    readback.recheck_current(snapshot, pull_request, merge_sha, image,
                             now=clock(), api=api)
    latest = github_objects(record, api)
    intake.validate_provenance(record, **latest,
        downloaded_artifact_digest=archive_digest,
        approval_branch_ref=api(f"repos/{intake.REPOSITORY}/git/ref/heads/{readback.BRANCH}"),
        record_fetched_at_sha=snapshot.branch_revision)
    return intake.validate_replay(record, result,
        branch_sha_before=snapshot.branch_revision,
        branch_sha_after=readback.current_ref(api))
