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
INVENTORY_JOB = "managed / build-smoke"
INVENTORY_STEP = "Inventory the exact tested image"


def trusted_run(run, now):
    if (run.get("event") != "push" or run.get("head_branch") != "dev" or
        run.get("path") != PRODUCER or
        run.get("head_repository", {}).get("full_name") != "arcee-ai/nac"):
        return False
    age = (now - timestamp(run["created_at"])).total_seconds()
    return 0 <= age <= 14 * 86400


def inventory_succeeded(jobs):
    producers = [job for job in jobs if job.get("name") == INVENTORY_JOB]
    if len(producers) != 1 or producers[0].get("status") != "completed":
        return False
    steps = [step for step in producers[0].get("steps", []) if step.get("name") == INVENTORY_STEP]
    return (len(steps) == 1 and steps[0].get("status") == "completed" and
            steps[0].get("conclusion") == "success")


def select_run(runs, artifacts_by_run, jobs_by_run, now):
    for run in runs:  # GitHub returns newest first.
        if not trusted_run(run, now) or not inventory_succeeded(jobs_by_run.get(run["id"], [])):
            continue
        expected = f"managed-image-security-{run['head_sha']}"
        artifacts = [a for a in artifacts_by_run.get(run["id"], []) if a.get("name") == expected]
        # Once successful inventory is selected, missing/expired evidence is an
        # error. Never silently fall back to an older green image.
        require(len(artifacts) == 1, "latest successful inventory artifact missing/ambiguous")
        require(not artifacts[0].get("expired", True), "latest successful inventory artifact expired")
        return run, artifacts[0]
    raise ValueError("no trusted completed dev inventory within 14 days; rerun a managed candidate")


def rescan(output):
    output.mkdir(parents=True, exist_ok=False)
    runs = json.loads(command(["gh", "api", "repos/arcee-ai/nac/actions/workflows/stable-release.yml/runs"
                             "?branch=dev&event=push&per_page=100"]))["workflow_runs"]
    artifacts, jobs = {}, {}
    selected = None
    now = dt.datetime.now(dt.timezone.utc)
    # API returns newest first. Avoid fetching artifacts for rejected/untrusted runs.
    for run in runs:
        if not trusted_run(run, now):
            continue
        jobs[run["id"]] = json.loads(command([
            "gh", "api", f"repos/arcee-ai/nac/actions/runs/{run['id']}/jobs?filter=latest&per_page=100"]))["jobs"]
        if not inventory_succeeded(jobs[run["id"]]):
            continue
        artifacts[run["id"]] = json.loads(command([
            "gh", "api", f"repos/arcee-ai/nac/actions/runs/{run['id']}/artifacts?per_page=100"]))["artifacts"]
        selected = select_run([run], artifacts, jobs, now)
        break
    require(selected is not None, "no trusted retained managed image bundle found (14-day window)")
    run, artifact = selected
    write_json(output / "selected-run.json", {"run": run, "artifact": artifact, "producer_jobs": jobs[run["id"]]})
    retained = output / "retained"
    bundle = retained / "inventory"
    command(["gh", "run", "download", str(run["id"]), "--repo", "arcee-ai/nac", "--name",
             artifact["name"], "--dir", retained])
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
