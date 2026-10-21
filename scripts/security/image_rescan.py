#!/usr/bin/env python3
"""Select trusted dev-push evidence for a daily unchanged-SBOM rescan."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess

from image_inventory import require, timestamp, write_json
from image_scan import ROOT, command

PRODUCER = ".github/workflows/stable-release.yml"
PRODUCER_JOBS = {"managed / build-smoke", "managed / Managed checks complete"}


def select_run(runs, artifacts_by_run, jobs_by_run, now):
    for run in runs:
        if (run.get("event") != "push" or run.get("head_branch") != "dev" or
            run.get("status") != "completed" or run.get("conclusion") not in {"success", "failure"} or run.get("path") != PRODUCER or
            run.get("head_repository", {}).get("full_name") != "arcee-ai/nac"):
            continue
        age = (now - timestamp(run["created_at"])).total_seconds()
        if not 0 <= age <= 14 * 86400:
            continue
        jobs = [job for job in jobs_by_run.get(run["id"], []) if job.get("name") in PRODUCER_JOBS]
        if ({job.get("name") for job in jobs} != PRODUCER_JOBS or len(jobs) != len(PRODUCER_JOBS) or
            any(job.get("status") != "completed" or job.get("conclusion") != "success" for job in jobs)):
            continue
        expected = f"managed-image-security-{run['head_sha']}"
        for artifact in artifacts_by_run.get(run["id"], []):
            if artifact.get("name") == expected and not artifact.get("expired", True):
                return run, artifact
    raise ValueError("no trusted completed dev image evidence within 14 days; rerun a managed candidate")


def rescan(output):
    output.mkdir(parents=True, exist_ok=False)
    runs = json.loads(command(["gh", "api", "repos/arcee-ai/nac/actions/workflows/stable-release.yml/runs"
                             "?branch=dev&event=push&status=completed&per_page=100"]))["workflow_runs"]
    artifacts, jobs = {}, {}
    selected = None
    now = dt.datetime.now(dt.timezone.utc)
    # API returns newest first. Avoid fetching artifacts for rejected/untrusted runs.
    for run in runs:
        if run.get("head_repository", {}).get("full_name") != "arcee-ai/nac" or run.get("event") != "push":
            continue
        artifacts[run["id"]] = json.loads(command([
            "gh", "api", f"repos/arcee-ai/nac/actions/runs/{run['id']}/artifacts?per_page=100"]))["artifacts"]
        jobs[run["id"]] = json.loads(command([
            "gh", "api", f"repos/arcee-ai/nac/actions/runs/{run['id']}/jobs?filter=latest&per_page=100"]))["jobs"]
        try:
            selected = select_run([run], artifacts, jobs, now)
            break
        except ValueError:
            continue
    require(selected is not None, "no trusted retained managed image bundle found (14-day window)")
    run, artifact = selected
    write_json(output / "selected-run.json", {"run": run, "artifact": artifact, "producer_jobs": jobs[run["id"]]})
    bundle = output / "retained"
    command(["gh", "run", "download", str(run["id"]), "--repo", "arcee-ai/nac", "--name",
             artifact["name"], "--dir", bundle])
    identity = json.loads((bundle / "identity.json").read_text())
    require(identity["source_revision"] == run["head_sha"], "bundle differs from trusted run SHA")
    policy = ROOT / ".github/security/exceptions.json"
    return subprocess.run(["python3", str(ROOT / "scripts/security/image_scan.py"),
                           "--bundle", str(bundle), "--image", identity["image"],
                           "--source-revision", run["head_sha"], "--trusted-policy", str(policy),
                           "--candidate-policy", str(policy), "--output", str(output / "rescan")]).returncode


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        raise SystemExit(rescan(args.output.resolve()))
    except Exception as error:
        print(f"daily image rescan failed closed: {error}")
        raise SystemExit(2)
