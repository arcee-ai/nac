"""Bounded, read-only download of one approved Actions artifact by numeric ID.

This source-only helper has no workflow caller or status token. The caller must
first authenticate the protected record and independently fetched artifact
metadata. GitHub's one redirect is inspected before a separate token-free GET.
An unrecognized storage origin fails closed until deliberately reviewed.
"""

import datetime as dt
import hashlib
import os
from pathlib import Path
import re
import stat
from urllib.parse import parse_qsl, urlsplit
import urllib.error
import urllib.request

import image_approval_intake as intake
from image_candidate_archive import MAX_ZIP_BYTES


HOST = re.compile(r"productionresultssa[0-9]{1,3}\.blob\.core\.windows\.net\Z")
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
STORAGE_PATH = re.compile(
    rf"/actions-results/{UUID}/workflow-job-run-{UUID}/artifacts/[0-9a-f]{{64}}\.zip\Z")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def open_once(request, *, timeout=30):
    """Do not forward a GitHub API bearer token across an implicit redirect."""
    try:
        return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        if error.code == 302:
            return error
        raise intake.ApprovalError("artifact download HTTP request failed") from None
    except (OSError, urllib.error.URLError):
        raise intake.ApprovalError("artifact download HTTP request failed") from None


def storage_url(location, now):
    """Accept only the observed GitHub Actions Azure archive redirect shape."""
    intake.require(isinstance(location, str) and 0 < len(location) <= 8192,
                   "missing or oversized artifact redirect")
    parsed = urlsplit(location)
    intake.require(parsed.scheme == "https" and parsed.hostname is not None and
                   HOST.fullmatch(parsed.hostname) and
                   parsed.netloc == parsed.hostname and not parsed.fragment and
                   STORAGE_PATH.fullmatch(parsed.path),
                   "artifact redirect origin/path is not approved")
    pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    params = dict(pairs)
    intake.require(len(pairs) == len(params) and
                   {"sig", "se", "sp", "spr"} <= set(params) and
                   params["sig"] and params["sp"] == "r" and
                   params["spr"] == "https",
                   "artifact redirect signature parameters differ")
    try:
        expiry = dt.datetime.fromisoformat(params["se"].replace("Z", "+00:00"))
    except ValueError as error:
        raise intake.ApprovalError("invalid artifact redirect expiry") from error
    intake.require(isinstance(now, dt.datetime) and now.tzinfo is not None and
                   now.utcoffset() == dt.timedelta() and
                   expiry.tzinfo is not None and expiry.utcoffset() == dt.timedelta() and
                   now < expiry <= now + dt.timedelta(minutes=15),
                   "artifact redirect is expired or implausibly long-lived")
    return location


def download(artifact_id, expected_digest, destination, *, read_token,
             open_request=open_once, clock=lambda: dt.datetime.now(dt.timezone.utc)):
    """Stream only the pinned ZIP bytes to an absent private regular file."""
    intake.positive_int(artifact_id, "artifact ID")
    intake.digest(expected_digest, "artifact digest")
    intake.require(isinstance(read_token, str) and bool(read_token),
                   "Actions-read token required")
    destination = Path(destination)
    intake.require(destination.parent.is_dir() and not destination.parent.is_symlink() and
                   not destination.exists() and not destination.is_symlink(),
                   "artifact output path is not absent in a regular directory")
    endpoint = (f"https://api.github.com/repos/{intake.REPOSITORY}"
                f"/actions/artifacts/{artifact_id}/zip")
    request = urllib.request.Request(endpoint, headers={
        "Authorization": f"Bearer {read_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"})
    response = open_request(request, timeout=30)
    try:
        intake.require(response.status == 302 and response.geturl() == endpoint,
                       "artifact API did not return the expected redirect")
        location = storage_url(response.headers.get("Location"), clock())
    finally:
        response.close()
    # Never send Authorization to the signed storage URL. No second redirect.
    storage_request = urllib.request.Request(location, headers={"Accept": "application/zip"})
    response = open_request(storage_request, timeout=30)
    created = False
    try:
        intake.require(response.status == 200 and response.geturl() == location,
                       "artifact storage response redirected or failed")
        declared = response.headers.get("Content-Length")
        if declared is not None:
            intake.require(declared.isdecimal() and 0 < int(declared) <= MAX_ZIP_BYTES,
                           "artifact storage length exceeds bound")
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        created = True
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(descriptor, "wb") as target:
            intake.require(stat.S_ISREG(os.fstat(target.fileno()).st_mode),
                           "artifact output is not regular")
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                size += len(chunk)
                intake.require(size <= MAX_ZIP_BYTES, "artifact archive exceeds byte bound")
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        intake.require(size > 0 and (declared is None or size == int(declared)) and
                       "sha256:" + digest.hexdigest() == expected_digest,
                       "downloaded artifact ZIP bytes or length differ from approved digest")
        return destination
    except Exception:
        if created:
            destination.unlink(missing_ok=True)
        raise
    finally:
        response.close()
