#!/usr/bin/env python3
"""Require a disjoint, complete partition of the current Playwright test inventory.

Inputs are native `playwright test --list --reporter=json` outputs. Generate the
complete inventory without filters, then every ordinary shard and the dedicated
goal-proof selection from the same checkout and config. This checks selection;
successful execution of every part remains a separate required job boundary.
"""

import argparse
import collections
import json
import pathlib


def inventory(report):
    if report.get("errors") != []:
        raise ValueError("Playwright inventory has collection errors")
    config = report["config"]
    if config["workers"] != 1 or config["fullyParallel"] is not False:
        raise ValueError("browser shards must retain one worker and file isolation")
    if any(project["retries"] != 0 for project in config["projects"]):
        raise ValueError("browser shards must retain zero retries")
    selected = []

    def visit(suites):
        for suite in suites:
            for spec in suite.get("specs", []):
                for test in spec["tests"]:
                    selected.append((
                        spec["id"], spec["file"], spec["line"], spec["column"],
                        spec["title"], test["projectId"], test["expectedStatus"],
                    ))
            visit(suite.get("suites", []))

    visit(report["suites"])
    if not selected or len(selected) != len(set(selected)):
        raise ValueError("browser inventory is empty or contains duplicate tests")
    return set(selected)


def validate(complete, parts):
    expected = inventory(complete)
    counts = collections.Counter()
    for part in parts:
        counts.update(inventory(part))
    duplicated = [test for test, count in counts.items() if count != 1]
    missing = expected - counts.keys()
    unexpected = counts.keys() - expected
    if duplicated or missing or unexpected:
        raise ValueError(
            f"browser partition mismatch: {len(missing)} missing, "
            f"{len(unexpected)} unexpected, {len(duplicated)} duplicated"
        )
    return len(expected)


def read_report(path):
    path = pathlib.Path(path)
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("browser inventory exceeds the bounded metadata limit")
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--complete", required=True)
    parser.add_argument("--part", action="append", required=True)
    args = parser.parse_args()
    count = validate(read_report(args.complete), [read_report(path) for path in args.part])
    print(f"Verified complete disjoint browser partition: {count} tests in {len(args.part)} parts")


if __name__ == "__main__":
    main()
