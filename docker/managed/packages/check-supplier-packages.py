#!/usr/bin/env python3
"""Bind owned APK admission to the exact reviewed supplier predecessors."""
import hashlib
import json
from pathlib import Path
import sys

OWNERS = ("krb5", "curl", "sasl", "gcc_headers")


def verify_predecessors(lock, database):
    expected, installed = {}, {}
    for owner in OWNERS:
        packages = lock[owner].get("supplier_packages")
        if not isinstance(packages, dict) or not packages:
            raise ValueError(f"missing supplier predecessors: {owner}")
        for name, version in packages.items():
            if not isinstance(name, str) or not name or not isinstance(version, str) or not version:
                raise ValueError(f"invalid supplier predecessor: {owner}")
            if name in expected and expected[name] != version:
                raise ValueError(f"conflicting supplier predecessor: {name}")
            expected[name] = version
    for block in database.split("\n\n"):
        fields = {}
        for line in block.splitlines():
            if line.startswith(("P:", "V:")):
                key, value = line.split(":", 1)
                if key in fields or not value:
                    raise ValueError("malformed supplier APK database")
                fields[key] = value
        if not fields:
            continue
        if set(fields) != {"P", "V"} or fields["P"] in installed:
            raise ValueError("incomplete/duplicate supplier APK database entry")
        installed[fields["P"]] = fields["V"]
    for name, version in expected.items():
        if installed.get(name) != version:
            raise ValueError(f"supplier predecessor differs: {name}: expected {version}, "
                             f"installed {installed.get(name)!r}")
    return {"schema_version": 1, "packages": {name: installed[name] for name in sorted(expected)},
            "database_sha256": hashlib.sha256(database.encode()).hexdigest()}


if __name__ == "__main__":
    receipt = verify_predecessors(json.loads(Path(sys.argv[1]).read_text()),
                                  Path("/lib/apk/db/installed").read_text())
    print(json.dumps(receipt, indent=2))
