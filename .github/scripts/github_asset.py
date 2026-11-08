#!/usr/bin/env python3
"""Fetch a public GitHub release asset; optional job token is API-hop-only."""
import argparse
import http.client
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class AssetError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def facts(response, phase):
    # Never print URLs, Location, response bodies, request headers or exceptions.
    values = [f"phase={phase}", f"status={response.code}"]
    for name in ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"]:
        value = response.headers.get(name, "")
        if re.fullmatch(r"[0-9]{1,20}", value):
            values.append(f"{name}={value}")
    print("GitHub asset HTTP " + " ".join(values), file=sys.stderr)


def download_asset(url, output, limit):
    if not re.fullmatch(r"https://api\.github\.com/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/assets/[1-9][0-9]*", url):
        raise AssetError("expected a public GitHub API release-asset URL")
    if type(limit) is not int or not 0 < limit <= 150 * 1024 * 1024:
        raise AssetError("invalid asset size bound")
    token = os.environ.get("GITHUB_TOKEN", "")
    if any(c in token for c in "\r\n"):
        raise AssetError("invalid job token")
    opener = urllib.request.build_opener(NoRedirect())
    output = Path(output)
    created = False
    try:
        for hop in range(6):
            headers = {"Accept": "application/octet-stream"}
            # Fresh headers on EVERY hop: even an API-to-API redirect loses auth.
            if hop == 0 and token:
                headers["Authorization"] = "Bearer " + token
            request = urllib.request.Request(url, headers=headers)
            try:
                response = opener.open(request, timeout=60)
            except urllib.error.HTTPError as error:
                response = error
            except (OSError, ValueError, http.client.HTTPException):
                raise AssetError("asset network request failed") from None
            with response:
                facts(response, "api" if hop == 0 else "asset")
                if response.code in [301, 302, 303, 307, 308]:
                    location = response.headers.get("Location", "")
                    url = urllib.parse.urljoin(url, location)
                    target = urllib.parse.urlsplit(url)
                    if not location or target.scheme != "https" or not target.hostname or target.username or target.password:
                        raise AssetError("unsafe asset redirect")
                    continue
                if response.code != 200:
                    raise AssetError("asset HTTP request failed")
                # Exclusive create also rejects existing files/symlinks; callers own
                # this temporary leaf and retain their independent integrity checks.
                descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                created = True
                with os.fdopen(descriptor, "wb") as destination:
                    total = 0
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > limit:
                            raise AssetError("asset exceeds size bound")
                        destination.write(chunk)
                return
        raise AssetError("too many asset redirects")
    except (OSError, ValueError, http.client.HTTPException) as error:
        if created:
            output.unlink(missing_ok=True)
        if isinstance(error, AssetError):
            raise error from None
        raise AssetError("asset transfer failed") from None
    except BaseException:
        if created:
            output.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-bytes", required=True, type=int)
    args = parser.parse_args()
    try:
        download_asset(args.url, args.output, args.max_bytes)
    except (AssetError, OSError, http.client.HTTPException):
        # A transport exception can contain a signed URL or injected server text.
        print("GitHub asset download failed; see allowlisted HTTP facts above", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
