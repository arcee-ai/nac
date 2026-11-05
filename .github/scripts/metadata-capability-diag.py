"""Private manual-only provider primitive screen. Never a production admission."""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

REPOSITORY = "arcee-ai/nac"
BRANCH = "refs/heads/codex/all-582-metadata-capability-registered"
WORKFLOW = ".github/workflows/nightly-portability.yml"
PROTECTED = {"Required PR checks", "source-security / Full locked source scan",
             "macos-native / ARM macOS process and credentials"}
LIMIT = 512 * 1024


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique)


def positive(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", value):
        raise ValueError("noncanonical positive decimal")
    return int(value)


def digest(source):
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError("noncanonical source")
    payload = ["DIAG-only-v1", REPOSITORY, source, WORKFLOW]
    return hashlib.sha256(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("public API redirect rejected")


class PublicReader:
    def __init__(self):
        self.end = time.monotonic() + 25
        self.count = 0
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, endpoint):
        if self.count >= 3 or time.monotonic() >= self.end:
            raise ValueError("public read budget exceeded")
        if not re.fullmatch(r"[A-Za-z0-9_./?-]+(?:=[A-Za-z0-9]+)?", endpoint):
            raise ValueError("invalid fixed public API endpoint")
        self.count += 1
        request = urllib.request.Request("https://api.github.com/" + endpoint, headers={
            "Accept": "application/vnd.github+json", "User-Agent": "nac-DIAG-metadata-v1",
            "X-GitHub-Api-Version": "2026-03-10"})
        with self.opener.open(request, timeout=min(8, self.end - time.monotonic())) as response:
            raw = response.read(LIMIT + 1)
            if response.status != 200 or len(raw) > LIMIT:
                raise ValueError("invalid or oversized public response")
        value = decode(raw)
        print(json.dumps({"DIAG_public_endpoint": endpoint, "bytes": len(raw),
                          "sha256": hashlib.sha256(raw).hexdigest(), "authenticated": False}))
        return value


def bound_rows(value, key):
    rows = value.get(key)
    if not isinstance(rows, list) or type(value.get("total_count")) is not int:
        raise ValueError("missing complete public list")
    if value["total_count"] != len(rows) or not 1 <= len(rows) <= 4:
        raise ValueError("incomplete or unexpected DIAG graph")
    return rows


def verify(prior, current_run, source, expected, read):
    prior_id, current_id = positive(prior), positive(current_run)
    if prior_id >= current_id:
        raise ValueError("self/future admission rejected")
    prefix = f"repos/{REPOSITORY}"
    run = read(f"{prefix}/actions/runs/{prior_id}")
    if (type(run.get("id")) is not int or run["id"] != prior_id
            or type(run.get("run_attempt")) is not int or run.get("run_attempt") != 1
            or run.get("status") != "completed" or run.get("event") != "workflow_dispatch"
            or run.get("display_title") != "DIAG metadata capability admit"
            or run.get("head_sha") != source or run.get("path") != WORKFLOW
            or run.get("head_branch") != BRANCH.removeprefix("refs/heads/")
            or run.get("repository", {}).get("full_name") != REPOSITORY):
        raise ValueError("foreign run/source/workflow/attempt")
    suite = run.get("check_suite_id")
    if type(suite) is not int or suite <= 0:
        raise ValueError("missing check suite identity")
    jobs = bound_rows(read(f"{prefix}/actions/runs/{prior_id}/attempts/1/jobs?per_page=100"), "jobs")
    checks = bound_rows(read(f"{prefix}/check-suites/{suite}/check-runs?per_page=100"), "check_runs")
    if any(not row.get("name", "").startswith("DIAG ") or row["name"] in PROTECTED
           for row in jobs + checks):
        raise ValueError("non-DIAG context")
    marker = [j for j in jobs if j["name"] == f"DIAG admission v1 {expected}"]
    if len(marker) != 1 or not marker[0].get("started_at"):
        raise ValueError("missing/ambiguous/unstarted admission")
    job = marker[0]
    job_id = positive(str(job.get("id")))
    if (job.get("run_id") != prior_id or job.get("head_sha") != source
            or job.get("check_run_url") != f"https://api.github.com/{prefix}/check-runs/{job_id}"):
        raise ValueError("admission job identity")
    match = [c for c in checks if c.get("id") == job_id]
    if (len(match) != 1 or match[0].get("name") != job["name"]
            or match[0].get("head_sha") != source
            or match[0].get("check_suite", {}).get("id") != suite
            or match[0].get("app", {}).get("id") != 15368):
        raise ValueError("admission check identity")
    # No conclusion/status/test result is used to admit PURE in this DIAG screen.
    print(json.dumps({"DIAG_verified_admission": {"run_id": prior_id, "attempt": 1,
          "job_id": job_id, "source": source, "digest": expected},
          "DIAG_job_names": [j["name"] for j in jobs],
          "DIAG_check_names": [c["name"] for c in checks], "quality_verdict_read": False}))


def main(env=os.environ):
    if (env.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or env.get("GITHUB_REF") != BRANCH
            or env.get("GITHUB_REPOSITORY") != REPOSITORY or env.get("GITHUB_RUN_ATTEMPT") != "1"):
        raise ValueError("only exact private first-attempt manual diagnostic is allowed")
    source = env.get("GITHUB_SHA", "")
    expected = digest(source)
    if env.get("DIAG_TUPLE_DIGEST") != expected:
        raise ValueError("incorrect DIAG digest")
    phase = env.get("DIAG_PHASE")
    prior = env.get("DIAG_PRIOR_RUN", "")
    if phase == "admit" and not prior:
        print("DIAG successful selector deliberately omits mode; no quality admission result")
    elif phase == "observe":
        verify(prior, env.get("GITHUB_RUN_ID", ""), source, expected, PublicReader())
        with Path(env["GITHUB_OUTPUT"]).open("a") as output:
            output.write("mode=pure\n")
    else:
        raise ValueError("invalid diagnostic phase/prior run")


if __name__ == "__main__":
    main()
