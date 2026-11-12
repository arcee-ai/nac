"""Inactive read-only caller for pinned source inputs and artifact-ID replay.

No workflow invokes this module. It never publishes a GitHub status and does
not authenticate the protected rulesets, reviewers, code origin or App.
"""

import datetime as dt
from pathlib import Path

import image_approval_artifact as artifact
import image_approval_intake as intake
import image_approval_readback as readback
import image_approval_replay as replay
import image_approval_source as source


def _stage(snapshot, root):
    root.mkdir(mode=0o700)
    trusted = root / "trusted"
    candidate = root / "candidate"
    trusted.mkdir(mode=0o700)
    candidate.mkdir(mode=0o700)
    paths = []
    for name, raw in (("exceptions.json", snapshot.exceptions),
                      ("image-applicability.json", snapshot.applicability)):
        for directory in (trusted, candidate):
            path = directory / name
            path.write_bytes(raw)
            path.chmod(0o600)
            paths.append(path)
    return paths[0], paths[1], paths[2], paths[3]


def run_from_github(pull_request, merge_sha, image, workspace, *,
                    trusted_revision, read_token, api=readback.fetch_json,
                    download=artifact.download, run_replay=replay.replay,
                    clock=lambda: dt.datetime.now(dt.timezone.utc)):
    """Return only an in-memory proposal for the pinned exact-image packet.

    ``trusted_revision`` must be the independently selected protected dev SHA.
    The caller still needs protected code, a read-only job and live ruleset
    verification before this could be used in a status-publishing system.
    """
    original = Path(workspace)
    root = original.resolve()
    intake.require(not original.exists() and not original.is_symlink() and
                   not root.exists(), "approval caller workspace already exists")
    now = clock()
    snapshot = readback.read_current(pull_request, merge_sha, image, now=now, api=api)
    record = intake.validate_record(snapshot.record, snapshot.policy, now=now)
    policies = source.read_policies(record["merge_sha"], trusted_revision, api=api)
    metadata = api(f"repos/{intake.REPOSITORY}/actions/artifacts/{record['artifact_id']}")
    intake.require(metadata.get("id") == record["artifact_id"] and
                   metadata.get("digest") == record["artifact_digest"] and
                   metadata.get("expired") is False,
                   "artifact metadata differs before download")
    root.mkdir(mode=0o700)
    trusted_policy, candidate_policy, trusted_applicability, candidate_applicability = (
        _stage(policies, root / "source"))
    archive = root / "artifact.zip"
    download(record["artifact_id"], record["artifact_digest"], archive,
             read_token=read_token)
    result = run_replay(pull_request, merge_sha, image, archive, root / "replay",
                        source_policy=trusted_policy, candidate_policy=candidate_policy,
                        source_applicability=trusted_applicability,
                        candidate_applicability=candidate_applicability,
                        api=api, clock=clock)
    source.recheck_current(policies, api=api)
    readback.recheck_current(snapshot, pull_request, merge_sha, image,
                             now=clock(), api=api)
    return result
