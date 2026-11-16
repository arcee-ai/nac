#!/usr/bin/env python3
"""Stage only the bounded, validated current-candidate ALL471 browser receipts.

The dedicated proof job runs the complete exact-goal-wait.e2e.ts file. Other
browser shards exclude that file; their success is independently required.
No output directory is created until both goal cases and cleanup ledgers pass.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import uuid


def stage(root, source):

    if not __debug__:
        raise RuntimeError("browser proof validation requires Python assertions enabled")
    root=pathlib.Path(root)
    dest=root/"all471-goal-proof-artifact"
    assert re.fullmatch(r"[0-9a-f]{40}",source)
    calls={
        "g1":{"g1-snapshot","g1-completion-wake","g1-quiet-settlement","g1-quiet-clear","g1-restart-cursor","g1-retained-proof"},
        "g2":{"g2-passive-before","g2-snapshot","g2-input-wait","g2-passive-after-input","g2-pause-wait","g2-quiet-settlement","g2-fresh-proof","g2-passive-final"},
    }
    fields={
        "g1":{"identity","initial","calls","settled","restarted","verified_read","native_complete"},
        "g2":{"identity","initial","calls","settled","human_pause","verified_read"},
    }

    def nonempty(value):
        assert isinstance(value,str) and value.strip()
        return value

    def canonical_id(value):
        assert str(uuid.UUID(nonempty(value)))==value and uuid.UUID(value).int
        return value

    def identity(value):
        assert set(value)=={"source","binary","binary_sha256","owner","profile","organization","host","incarnation","release"}
        assert value["source"]==source and re.fullmatch(r"[0-9a-f]{64}",value["binary_sha256"])
        for field in value:
            nonempty(value[field])
        assert json.loads(value["release"])[3]==source

    def proof(value,case):
        assert set(value)==fields[case]
        identity(value["identity"])
        initial=value["initial"]
        for field in ("target","caller","project"):
            nonempty(initial[field])
        goal=canonical_id(initial["goal"]["goal_id"])
        run=canonical_id(initial["goal"]["accounting_run_id"])
        settled=value["settled"]
        assert settled["goal_id"]==goal and isinstance(settled["version"],int)
        assert {"status","accounting_run_id","last_failure"}<=set(settled)
        assert set(value["calls"])==calls[case]
        for name,result in value["calls"].items():
            nonempty(result["status"])
            if name in {"g2-passive-before","g2-passive-after-input","g2-passive-final"}:
                task=result["task"]
                assert task["session_id"]==initial["target"] and task["project_id"]==initial["project"]
                assert isinstance(task["durable"],dict) and isinstance(task["ephemeral"],dict)
                assert task["durable"]["goal"]["goal_id"]==goal
            else:
                assert len(result["targets"])==1
                target=result["targets"][0]
                assert target["session_id"]==initial["target"] and target["mode"]=="goal" and target["resolved_identity"]==goal
                nonempty(target["status"])
                nonempty(target["after_cursor"])
                if "proof" in target:
                    assert target["proof"]["goal_id"]==goal and target["proof"]["last_run_id"]==run
        fresh="g1-retained-proof" if case=="g1" else "g2-fresh-proof"
        assert {"goal_id","last_run_id","version","retained"}<=set(value["calls"][fresh]["targets"][0]["proof"])
        nonempty(value["verified_read"])
        if case=="g1":
            nonempty(value["native_complete"])
            identity(value["restarted"])
            return value["restarted"]["binary"]
        pause=value["human_pause"]
        assert isinstance(pause["http_status"],int)
        assert pause["goal"]["goal_id"]==goal and pause["goal"]["accounting_run_id"]==run
        assert isinstance(pause["goal"]["version"],int)
        return value["identity"]["binary"]

    selected={}
    for case in ("g1","g2"):
        values={}
        for kind,limit in (("proof",131072),("cleanup",4096)):
            name=f"all471-{case}-{kind}.json"
            matches=list(root.glob("*/"+name))
            assert len(matches)==1,(name,len(matches))
            src=matches[0]
            assert not src.parent.is_symlink()
            with os.fdopen(os.open(src,os.O_RDONLY|os.O_NOFOLLOW),"rb") as handle:
                descriptor=os.fstat(handle.fileno())
                assert stat.S_ISREG(descriptor.st_mode) and descriptor.st_size<=limit
                payload=handle.read(limit+1)
            assert len(payload)<=limit
            values[kind]=json.loads(payload)
            selected[name]=payload
        binary=proof(values["proof"],case)
        cleanup=values["cleanup"]
        assert set(cleanup)=={"pid","binaryPath","baseUrl","provider","exitCode","signalCode"}
        assert isinstance(cleanup["pid"],int) and cleanup["pid"]>0 and cleanup["binaryPath"]==binary
        assert cleanup["exitCode"] is not None or cleanup["signalCode"] is not None

    manifest={"source_revision":source,"files":{name:{"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()} for name,data in selected.items()}}
    manifest_bytes=(json.dumps(manifest,indent=2)+"\n").encode()
    assert len(manifest_bytes)<=4096
    selected["manifest.json"]=manifest_bytes
    assert len(selected)==5 and sum(map(len,selected.values()))<=274432
    # No destination is published until both complete cases and ledgers validate.
    dest.mkdir()
    for name,data in selected.items():
        (dest/name).write_bytes(data)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    stage(args.root, args.source)


if __name__ == "__main__":
    main()
