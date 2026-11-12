"""Inactive protected-code entrypoint for same-call exact-image replay.

The workflow job is permanently skipped and all authority pins are unset.
This entrypoint has no status writer or reusable success receipt.
"""

import argparse
import datetime as dt
import os

import image_approval_authority as authority
import image_approval_caller as caller
import image_approval_intake as intake
import image_approval_readback as readback


def prepare(pull_request, merge_sha, image, workspace, *,
            pins=authority.AuthorityPins(), token_source=lambda: os.environ.get("GH_TOKEN"),
            clock=lambda: dt.datetime.now(dt.timezone.utc)):
    """Verify one exact snapshot twice around strict replay; return no clearance.

    Future activation must set pins in reviewed protected code, use a read-only
    token, and integrate a separate App writer with merge-time freshness.
    Caller inputs cannot choose authority anchors or a status credential.
    """
    # Default/unreviewed pins fail before GitHub API, checkout or token access.
    authority.configured(pins)
    now = clock()
    snapshot = readback.read_current(pull_request, merge_sha, image, now=now)
    record = intake.validate_record(snapshot.record, snapshot.policy, now=now)
    authority.verify(snapshot, pins=pins, now=now)
    token = token_source()
    intake.require(isinstance(token, str) and bool(token),
                   "read-only Actions token is unavailable")
    proposal = caller.run_from_github(pull_request, merge_sha, image, workspace,
                                      trusted_revision=pins.trusted_dev_revision,
                                      read_token=token, clock=clock)
    current = readback.read_current(pull_request, merge_sha, image, now=clock())
    intake.require(current == snapshot,
                   "protected image record, policy or evidence changed during replay")
    authority.verify(current, pins=pins, now=clock())
    intake.require(record["pull_request"] == pull_request and
                   record["merge_sha"] == merge_sha and record["image"] == image and
                   proposal == {"state": "success", "context": intake.STATUS_CONTEXT,
                                "description": "Exact frozen image passed reviewed security replay",
                                "sha": merge_sha},
                   "exact image replay proposal differs")
    # A success value is deliberately not transferable to another image/job.


def main():
    parser = argparse.ArgumentParser(description="Inactive exact-image approval replay")
    parser.add_argument("pull_request", type=int)
    parser.add_argument("merge_sha")
    parser.add_argument("image")
    parser.add_argument("workspace")
    args = parser.parse_args()
    prepare(args.pull_request, args.merge_sha, args.image, args.workspace)


if __name__ == "__main__":
    main()
