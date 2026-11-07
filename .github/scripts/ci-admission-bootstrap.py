"""Run only an immutable original-base owner; emit safe reusable-unit outputs."""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

OWNER = ".github/scripts/ci-admission.py"
BOOTSTRAP = ".github/scripts/ci-admission-bootstrap.py"


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate event key")
        result[key] = value
    return result


def fallback(reason):
    return {"schema_version": 2, "mode": "full", "reason": reason, "quality_reused": False}


def outputs(result):
    if not isinstance(result, dict):
        return {"mode": "full", "marker_name": "NAC admission unavailable"}
    require = type(result.get("schema_version")) is int and result.get("schema_version") == 2 and result.get("mode") in ["full", "pure"] and result.get("quality_reused") is False
    if not require:
        result = fallback("invalid_trusted_owner_output")
    values = {"mode": result["mode"], "marker_name": "NAC admission unavailable"}
    digest = result.get("tuple_digest")
    if isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest):
        if result["mode"] == "full":
            values.update(tuple_digest=digest, marker_name="NAC full admission v2 " + digest)
        else:
            pointer = result.get("admission", {})
            run = pointer.get("run_id")
            if type(run) is int and 0 < run <= 2**53-1 and type(pointer.get("attempt")) is int and pointer.get("attempt") == 1 and pointer.get("tuple_digest") == digest:
                expected = hashlib.sha256(json.dumps([2, digest, run, 1], separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
                if result.get("observation_digest") == expected:
                    values.update(tuple_digest=digest, observation_digest=expected,
                                  marker_name="NAC metadata observation v2 " + expected)
    if values["mode"] == "pure" and "observation_digest" not in values:
        return {"mode": "full", "marker_name": "NAC admission unavailable"}
    return values


def bootstrap(repository, event_path, env=os.environ):
    try:
        fd = os.open(event_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                return fallback("nonregular_original_event")
            raw = source.read(8*1024**2+1)
        if len(raw) > 8*1024**2:
            return fallback("oversized_original_event")
        event = json.loads(raw, object_pairs_hook=unique)
        if env.get("GITHUB_EVENT_NAME") != "pull_request":
            return fallback("non_pr_full")
        repository_identity = event.get("repository", {})
        base_identity = event.get("pull_request", {}).get("base", {}).get("repo", {})
        if (env.get("GITHUB_REPOSITORY") != "arcee-ai/nac"
                or repository_identity.get("id") != 1194218201 or repository_identity.get("full_name") != "arcee-ai/nac"
                or base_identity.get("id") != 1194218201 or base_identity.get("full_name") != "arcee-ai/nac"):
            return fallback("foreign_original_base_authority")
        base = event.get("pull_request", {}).get("base", {}).get("sha", "")
        if not isinstance(base, str) or not re.fullmatch(r"[a-f0-9]{40}", base):
            return fallback("unknown_original_base")
        def blob(path):
            result = subprocess.run(["git", "--no-replace-objects", "-C", str(repository), "show", base+":"+path],
                capture_output=True, check=True, timeout=10,
                env={**env, "GIT_NO_LAZY_FETCH":"1", "GIT_NO_REPLACE_OBJECTS":"1", "GIT_GRAFT_FILE":os.devnull})
            if len(result.stdout) > 512*1024:
                raise ValueError("oversized trusted program")
            return result.stdout
        if blob(BOOTSTRAP) != Path(__file__).read_bytes():
            return fallback("bootstrap_not_original_base_program")
        owner = blob(OWNER)
        for key in ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]:
            if not re.fullmatch(r"[1-9][0-9]*", env.get(key, "")):
                return fallback("unknown_original_run")
        context = {"event_name": env["GITHUB_EVENT_NAME"], "run_id":int(env["GITHUB_RUN_ID"]),
                   "run_attempt":int(env["GITHUB_RUN_ATTEMPT"]), "candidate_sha":env.get("GITHUB_SHA"),
                   "policy_sha":base, "workflow_sha":env.get("GITHUB_WORKFLOW_SHA")}
        with tempfile.TemporaryDirectory(prefix="nac-base-admission-") as temp:
            trusted = Path(temp)/"ci-admission.py"
            trusted.write_bytes(owner)
            context_path = Path(temp)/"context.json"
            context_path.write_text(json.dumps(context))
            result = subprocess.run([sys.executable, str(trusted), "--event", str(event_path),
                                    "--context", str(context_path), "--repository", str(repository)],
                                    capture_output=True, check=True, timeout=75, env=env)
            if len(result.stdout) > 16*1024:
                return fallback("oversized_trusted_owner_output")
            return json.loads(result.stdout, object_pairs_hook=unique)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        return fallback("unavailable_trusted_base_owner")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--event", type=Path, required=True)
    args = parser.parse_args()
    result = bootstrap(args.repository, args.event)
    selected = outputs(result)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as target:
        for key, value in selected.items():
            target.write(key+"="+value+"\n")
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
