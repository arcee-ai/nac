#!/usr/bin/env python3
"""Passively sample one already-launched disposable Electron candidate.

Uses the existing coalition/process collector. Never launches, signals, hides or
quits an app. The caller owns ordinary protected Quit and cleanup evidence.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time

from compare import HERE, coalition, digest, idle_summary, process_table, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--engine-pid', type=int, required=True)
    parser.add_argument('--seconds', type=int, default=10)
    parser.add_argument('--label', choices=['off-visible', 'on-visible', 'off-hidden', 'on-hidden'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 60 or min(args.pid, args.engine_pid) <= 0:
        parser.error('Sampling requires positive exact PIDs and 1–60 seconds.')
    bundle = args.bundle.resolve(strict=True)
    engine = bundle / 'Contents/Resources/nac-web'
    executable = bundle / 'Contents/MacOS/NAC'
    manifest_file = bundle / 'Contents/Resources/manifest.json'
    manifest = json.loads(manifest_file.read_text())
    if digest(engine) != manifest['engineSha256']:
        raise RuntimeError('Bundled engine hash does not match manifest')
    args.output.mkdir(parents=True, exist_ok=False)
    sampler = args.output / 'process-sample'
    run(['xcrun', 'clang', '-O2', '-Wall', '-Wextra', HERE / 'process_sample.c', '-o', sampler])
    receipt = dict(schema_version=1, acceptance='bounded-observer-diagnostic-only',
                   recorded_at_utc=datetime.now(timezone.utc).isoformat(), label=args.label,
                   source_revision=manifest['sourceRevision'],
                   manifest_sha256=digest(manifest_file), engine_sha256=digest(engine),
                   collector_source_sha256={name: digest(HERE / name) for name in
                                            ('observe.py', 'compare.py', 'process_sample.c')},
                   collector_sha256=digest(sampler),
                   os=run(['sw_vers', '-productVersion'], text=True).strip(),
                   power=run(['pmset', '-g', 'batt'], text=True).strip(),
                   settings=dict(seconds=args.seconds, interval_seconds=1,
                                 visibility='caller-observed; attach native facts separately',
                                 cleanup='caller-owned; sampling never establishes cleanup'),
                   samples=[], result='pending')
    identities = {}
    group = None
    try:
        for index in range(args.seconds + 1):
            if index:
                time.sleep(1)
            began = time.monotonic()
            table = process_table()
            if table.get(args.pid, {}).get('executable') != str(executable):
                raise RuntimeError('Exact app executable is absent or replaced')
            if table.get(args.engine_pid, {}).get('executable') != str(engine):
                raise RuntimeError('Exact bundled engine is absent or replaced')
            custody = table.get(args.engine_pid, {}).get('ppid')
            if table.get(custody, {}).get('ppid') != args.pid:
                raise RuntimeError('Engine custody is not owned by this app')
            current_group, members = coalition(args.pid, bundle)
            if group is not None and current_group != group:
                raise RuntimeError('App coalition changed')
            group = current_group
            while True:
                expanded = members | {pid for pid, entry in table.items() if entry['ppid'] in members}
                if expanded == members:
                    break
                members = expanded
            if not {args.pid, args.engine_pid, custody} <= members:
                raise RuntimeError('Owned process census is incomplete')
            values = json.loads(run([sampler, *sorted(members)]))
            valid = []
            for value in values:
                if not value['valid']:
                    continue
                pid = value['pid']
                birth = (value['birth_sec'], value['birth_usec'])
                if pid in identities and identities[pid] != birth:
                    raise RuntimeError('Sampled process incarnation changed')
                identities[pid] = birth
                value['role'] = Path(table.get(pid, {}).get('executable', 'unknown')).name
                value['is_engine'] = pid == args.engine_pid
                valid.append(value)
            if not {args.pid, args.engine_pid, custody} <= {v['pid'] for v in valid}:
                raise RuntimeError('Owned process counters are unavailable')
            receipt['samples'].append(dict(monotonic=time.monotonic(), coalition=group,
                                           processes=valid,
                                           unavailable_pids=[v['pid'] for v in values if not v['valid']],
                                           collector_ms=(time.monotonic() - began) * 1000))
        receipt['summary'] = idle_summary(receipt['samples'])
        if not receipt['summary']['complete_stable_intervals']:
            raise RuntimeError('Incomplete census or changing membership; no resource verdict')
        receipt['result'] = 'complete'
    except Exception as error:
        receipt['result'] = 'failed'
        receipt['error_type'] = type(error).__name__
        raise
    finally:
        (args.output / 'samples.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
