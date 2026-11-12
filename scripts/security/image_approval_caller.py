"""Inactive read-only caller for pinned source inputs and artifact-ID replay.

No workflow invokes this module. It never publishes a GitHub status and does
not authenticate the protected rulesets, reviewers, code origin or App.
"""

import datetime as dt
from contextlib import contextmanager
import os
from pathlib import Path
import stat

import image_approval_artifact as artifact
import image_approval_intake as intake
import image_approval_readback as readback
import image_approval_replay as replay
import image_approval_source as source


@contextmanager
def _private_parent(parent):
    """Pin a private parent against other UIDs; the job must run no untrusted same-UID code."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    uid = os.getuid()
    descriptor = os.open("/", flags)
    try:
        for part in parent.parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            intake.require(stat.S_ISDIR(info.st_mode) and
                           info.st_uid in (0, uid) and
                           (info.st_mode & 0o022 == 0 or
                            (info.st_uid == 0 and info.st_mode & stat.S_ISVTX)),
                           "approval caller workspace ancestor is writable or unowned")
        info = os.fstat(descriptor)
        intake.require(info.st_uid == uid and stat.S_IMODE(info.st_mode) == 0o700,
                       "approval caller workspace parent must be private and owned")
    except OSError as error:
        os.close(descriptor)
        raise intake.ApprovalError("approval caller workspace path is unsafe") from error
    except BaseException:
        os.close(descriptor)
        raise
    try:
        yield descriptor
    finally:
        os.close(descriptor)


def _new_workspace(root, parent_descriptor):
    try:
        os.mkdir(root.name, mode=0o700, dir_fd=parent_descriptor)
        descriptor = os.open(root.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=parent_descriptor)
    except FileExistsError as error:
        raise intake.ApprovalError("approval caller workspace already exists") from error
    except OSError as error:
        raise intake.ApprovalError("approval caller workspace creation failed") from error
    try:
        info = os.fstat(descriptor)
        selected = root.stat(follow_symlinks=False)
        intake.require(info.st_uid == os.getuid() and
                       stat.S_IMODE(info.st_mode) == 0o700 and
                       (info.st_dev, info.st_ino) == (selected.st_dev, selected.st_ino),
                       "approval caller workspace identity or permissions changed")
    finally:
        os.close(descriptor)


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
    intake.require(not root.is_relative_to(replay.ROOT),
                   "approval caller workspace must be outside repository")
    intake.require(not original.exists() and not original.is_symlink() and
                   not root.exists(), "approval caller workspace already exists")
    with _private_parent(root.parent) as parent_descriptor:
        now = clock()
        snapshot = readback.read_current(pull_request, merge_sha, image, now=now, api=api)
        record = intake.validate_record(snapshot.record, snapshot.policy, now=now)
        policies = source.read_policies(record["merge_sha"], trusted_revision, api=api)
        metadata = api(f"repos/{intake.REPOSITORY}/actions/artifacts/{record['artifact_id']}")
        intake.require(metadata.get("id") == record["artifact_id"] and
                       metadata.get("digest") == record["artifact_digest"] and
                       metadata.get("expired") is False,
                       "artifact metadata differs before download")
        _new_workspace(root, parent_descriptor)
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
