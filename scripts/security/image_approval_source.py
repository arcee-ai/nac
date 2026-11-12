"""Inert, pinned Git-blob source inputs for an exact-image approval replay.

The protected caller must separately authenticate the dev ruleset and its own
code before these bytes can carry policy authority. A PR's base SHA is not a
trusted source when the base is another unmerged author branch.
"""

from dataclasses import dataclass

import image_approval_intake as intake
import image_approval_readback as readback


TRUSTED_BRANCH = "dev"
POLICIES = (".github/security/exceptions.json",
            ".github/security/image-applicability.json")
MAX_POLICY_BYTES = 1024 * 1024


@dataclass(frozen=True)
class SourceSnapshot:
    trusted_revision: str
    candidate_revision: str
    exceptions: bytes
    applicability: bytes


def current_trusted_ref(api):
    """Pin current protected dev, without asserting its ruleset or reviewers."""
    prefix = f"repos/{intake.REPOSITORY}"
    repository = api(prefix)
    branch = api(f"{prefix}/branches/{TRUSTED_BRANCH}")
    ref = api(f"{prefix}/git/ref/heads/{TRUSTED_BRANCH}")
    obj = ref.get("object")
    sha = obj.get("sha") if type(obj) is dict else None
    intake.require(repository.get("id") == readback.REPOSITORY_ID and
                   repository.get("full_name") == intake.REPOSITORY and
                   branch.get("name") == TRUSTED_BRANCH and
                   branch.get("protected") is True and
                   type(branch.get("commit")) is dict and
                   branch["commit"].get("sha") == sha and
                   ref.get("ref") == f"refs/heads/{TRUSTED_BRANCH}" and
                   type(obj) is dict and obj.get("type") == "commit" and
                   isinstance(sha, str) and readback.GIT_SHA.fullmatch(sha),
                   "trusted policy repository, protected branch or ref differs")
    return sha


def read_policies(candidate_revision, trusted_revision, *, api=readback.fetch_json):
    """Read only regular Git blobs at exact immutable revisions.

    Candidate policy must be byte-identical to the current protected dev
    snapshot; any candidate policy edit needs a separately reviewed landing.
    """
    intake.hex_sha(candidate_revision, "candidate merge revision")
    intake.hex_sha(trusted_revision, "trusted policy revision")
    intake.require(current_trusted_ref(api) == trusted_revision,
                   "trusted policy revision is no longer current dev")
    trusted_tree = readback.pinned_tree(api, trusted_revision)
    candidate_tree = readback.pinned_tree(api, candidate_revision)
    values = []
    for path in POLICIES:
        trusted = readback.pinned_blob(api, trusted_tree, path, MAX_POLICY_BYTES)
        candidate = readback.pinned_blob(api, candidate_tree, path, MAX_POLICY_BYTES)
        intake.require(candidate == trusted,
                       "candidate source policy differs from reviewed dev bytes")
        values.append(trusted)
    intake.require(current_trusted_ref(api) == trusted_revision,
                   "trusted policy branch moved during source read")
    return SourceSnapshot(trusted_revision, candidate_revision, *values)


def recheck_current(snapshot, *, api=readback.fetch_json):
    intake.require(isinstance(snapshot, SourceSnapshot), "prior source snapshot required")
    current = read_policies(snapshot.candidate_revision, snapshot.trusted_revision, api=api)
    intake.require(current == snapshot, "source policy bytes changed during replay")
    return current
