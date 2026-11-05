#!/usr/bin/env python3
"""Read-only Actions timing snapshots; successful metrics are not cohort acceptance.

Capture: python3 .github/scripts/ci-timings.py capture RUN[:ATTEMPT] ... --output DIR
Summarize existing snapshots: python3 .github/scripts/ci-timings.py summarize DIR ...
Each capture uses a new output directory and retains incomplete/failed snapshots.
No cache-state, representative-change, cost-rate, or coverage-parity claims are inferred.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("missing timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp lacks timezone")
    return parsed


def identity(log, names):
    # Match printed runner environment, never shell source containing $VARIABLE.
    pattern = r"(?:^|\s)(?:" + "|".join(names) + r"): ([a-f0-9]{40})(?:\s|$)"
    values = set(re.findall(pattern, log, flags=re.MULTILINE))
    if len(values) != 1:
        raise ValueError("missing or conflicting candidate identity in job log")
    return values.pop()


def summarize(run, jobs, logs, repository):
    reasons = []
    result = {"run_id": run.get("id"), "attempt": run.get("run_attempt"),
              "url": run.get("html_url"), "event": run.get("event"),
              "branch_head_sha": run.get("head_sha"), "candidate_sha": None,
              "status": run.get("status"), "conclusion": run.get("conclusion"),
              "processing_seconds": None, "event_to_green_seconds": None,
              "observed_prepare_to_result_seconds": None, "observed_event_to_result_seconds": None,
              "initial_wait_seconds": None, "metric_eligible": False,
              "ordinary_first_attempt_metric": False, "cohort_qualified": False,
              "cohort_remaining": ["consecutive ordinary run sequence", "at least five meaningful source SHAs",
                                   "representative backend/managed/frontend/docs cases", "controlled cold-cache evidence",
                                   "complete coverage matrix and negative controls", "cache/resources/cost disclosure"]}
    if run.get("repository", {}).get("full_name") != repository:
        reasons.append("repository differs from capture request")
    attempt = run.get("run_attempt")
    if not isinstance(attempt, int) or attempt < 1:
        reasons.append("invalid run attempt")
    ids = [job.get("id") for job in jobs]
    if len(ids) != len(set(ids)):
        reasons.append("duplicate job IDs")
    if any(job.get("run_id") != run.get("id") or job.get("run_attempt") != attempt for job in jobs):
        reasons.append("foreign run or attempt job evidence")
    selected = {}
    for name in ("prepare", "Required PR checks"):
        matches = [job for job in jobs if job.get("name") == name]
        if len(matches) != 1:
            reasons.append(f"expected exactly one {name} job")
        else:
            selected[name] = matches[0]
    compute = defaultdict(float)
    incomplete_compute = []
    for job in jobs:
        if job.get("conclusion") == "skipped":
            continue
        try:
            start, end = timestamp(job.get("started_at")), timestamp(job.get("completed_at"))
            if end < start or job.get("status") != "completed":
                raise ValueError("incomplete or invalid duration")
            runner = json.dumps({"labels": job.get("labels", []), "runner_group": job.get("runner_group_name")}, sort_keys=True)
            compute[runner] += (end - start).total_seconds()
        except (ValueError, TypeError):
            incomplete_compute.append(job.get("id"))
    result["completed_job_seconds_by_runner"] = dict(compute)
    result["completed_job_seconds"] = sum(compute.values())
    result["incomplete_compute_job_ids"] = incomplete_compute
    if incomplete_compute:
        reasons.append("missing or invalid executed-job duration evidence")
    result["cost"] = "not estimated; runner-seconds are not billable cost or CPU time"
    if "prepare" in selected:
        prepare = selected["prepare"]
        try:
            candidate = identity(logs.get(str(prepare["id"]), ""), ["SOURCE_SHA", "CANDIDATE_SHA"])
            result["candidate_sha"] = candidate
        except ValueError as error:
            reasons.append(str(error))
        try:
            event, start = timestamp(run.get("created_at")), timestamp(prepare.get("started_at"))
            if start < event:
                raise ValueError("preparation predates event")
            result["initial_wait_seconds"] = (start-event).total_seconds()
        except (ValueError, TypeError) as error:
            reasons.append(str(error))
    if len(selected) == 2:
        prepare, required = selected["prepare"], selected["Required PR checks"]
        try:
            if identity(logs.get(str(required["id"]), ""), ["EXPECTED_SHA"]) != result["candidate_sha"]:
                raise ValueError("final aggregate candidate differs from preparation")
        except ValueError as error:
            reasons.append(str(error))
        try:
            event, start, end = timestamp(run.get("created_at")), timestamp(prepare.get("started_at")), timestamp(required.get("completed_at"))
            if not event <= start <= end:
                raise ValueError("invalid event/preparation/aggregate ordering")
            # Observed elapsed time includes all inter-job waits, setup, artifacts and aggregation.
            result.update(observed_prepare_to_result_seconds=(end-start).total_seconds(),
                          observed_event_to_result_seconds=(end-event).total_seconds(),
                          initial_wait_seconds=(start-event).total_seconds())
        except (ValueError, TypeError) as error:
            reasons.append(str(error))
        if prepare.get("conclusion") != "success" or required.get("conclusion") != "success":
            reasons.append("preparation or required aggregate did not succeed")
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        reasons.append("workflow is not a completed success")
    if any(job.get("status") != "completed" or job.get("conclusion") not in ("success", "skipped") for job in jobs):
        reasons.append("failed/cancelled/pending/incomplete job evidence")
    result["ineligible_reasons"] = reasons
    result["metric_eligible"] = not reasons
    result["ordinary_first_attempt_metric"] = not reasons and run.get("event") == "pull_request" and attempt == 1
    if not reasons:
        result["processing_seconds"] = result["observed_prepare_to_result_seconds"]
        result["event_to_green_seconds"] = result["observed_event_to_result_seconds"]
    return result


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def capture(repository, selection, output):
    if output.exists() and any(output.iterdir()):
        raise ValueError("capture requires a new or empty output directory")
    output.mkdir(parents=True, exist_ok=True)
    commands, errors = [], []

    def fetch(endpoint, filename, paginate=False):
        command = ["gh", "api", "--allow-escape-sequences"]
        if paginate:
            command += ["--paginate", "--slurp"]
        command += [endpoint]
        started = datetime.now(timezone.utc).isoformat()
        response = subprocess.run(command, capture_output=True, text=True, check=False)
        (output / filename).write_text(response.stdout)
        (output / (filename + ".stderr")).write_text(response.stderr)
        commands.append({"command": command, "started_at": started,
                         "completed_at": datetime.now(timezone.utc).isoformat(), "returncode": response.returncode,
                         "stdout": filename, "sha256": hashlib.sha256(response.stdout.encode()).hexdigest()})
        write_json(output / "commands.json", commands)
        if response.returncode:
            errors.append({"command": command, "returncode": response.returncode, "stderr": response.stderr})
            write_json(output / "fetch-errors.json", errors)
            return None
        return response.stdout

    summaries = []
    for value in selection:
        match = re.fullmatch(r"([1-9][0-9]*)(?::([1-9][0-9]*))?", value)
        if not match:
            raise ValueError("run selection must be RUN or RUN:ATTEMPT")
        run_id, requested = match.groups()
        prefix = f"repos/{repository}/actions/runs/{run_id}"
        latest = fetch(prefix, f"{run_id}-latest.json")
        if latest is None:
            summaries.append({"run_id": int(run_id), "metric_eligible": False, "capture_error": "run unavailable"})
            continue
        attempt = int(requested or json.loads(latest)["run_attempt"])
        folder = output / f"run-{run_id}-attempt-{attempt}"
        folder.mkdir()
        run_text = fetch(f"{prefix}/attempts/{attempt}", f"{folder.name}/run.json")
        jobs_text = fetch(f"{prefix}/attempts/{attempt}/jobs?per_page=100", f"{folder.name}/job-pages.json", True)
        if run_text is None or jobs_text is None:
            summaries.append({"run_id": int(run_id), "attempt": attempt, "metric_eligible": False, "capture_error": "attempt unavailable"})
            continue
        run = json.loads(run_text)
        pages = json.loads(jobs_text)
        jobs = [job for page in pages for job in page["jobs"]]
        write_json(folder / "jobs.json", jobs)
        logs = {}
        for job in jobs:
            if job.get("name") in ("prepare", "Required PR checks"):
                log = fetch(f"repos/{repository}/actions/jobs/{job['id']}/logs", f"{folder.name}/job-{job['id']}.log")
                if log is not None:
                    logs[str(job["id"])] = log
        summary = summarize(run, jobs, logs, repository)
        write_json(folder / "summary.json", summary)
        summaries.append(summary)
    write_json(output / "summary.json", {"captured_at": datetime.now(timezone.utc).isoformat(), "repository": repository,
                                         "selection": selection, "runs": summaries, "fetch_errors": errors})
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("capture")
    collect.add_argument("runs", nargs="+")
    collect.add_argument("--repository", default="arcee-ai/nac")
    collect.add_argument("--output", type=Path, required=True)
    report = sub.add_parser("summarize")
    report.add_argument("directories", nargs="+", type=Path)
    args = parser.parse_args()
    if args.command == "capture":
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repository):
            parser.error("invalid repository")
        result = capture(args.repository, args.runs, args.output)
    else:
        result = []
        for folder in args.directories:
            run = json.loads((folder / "run.json").read_text())
            jobs = json.loads((folder / "jobs.json").read_text())
            logs = {path.stem.removeprefix("job-"): path.read_text() for path in folder.glob("job-*.log")}
            result.append(summarize(run, jobs, logs, run["repository"]["full_name"]))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"ci-timings: {error}", file=sys.stderr)
        sys.exit(2)
