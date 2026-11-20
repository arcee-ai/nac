#!/usr/bin/env python3
"""Fail closed on unclassified legacy product vocabulary in tracked text."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = 'scripts/direct-retirement/'
# This digest binds the sorted union of all three inventories at the named
# baseline. Individual dispositions can be updated without deleting paths.
BASELINE_REVISION = '914782659a6183b89070a3516e2e44776b1eeb06'
BASELINE_ROSTER_SHA256 = '19276b265f9e77b6ac305fad6acff3dcd6326bba521098e8135f47e5253cea0a'
METADATA = {DIRECTORY + 'rules.json', DIRECTORY + 'baseline-paths.json'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compile_rules(data):
    if data.get('version') != 1 or not isinstance(data.get('rules'), list):
        raise ValueError('invalid retirement rule manifest')
    compiled = {}
    for row in data['rules']:
        name, pattern = row['id'], re.compile(row['pattern'])
        if not name or name in compiled or pattern.search(''):
            raise ValueError('duplicate, empty, or overbroad rule')
        compiled[name] = pattern
    return compiled


def audit(files, data):
    """Return unclassified matches and invalid/stale exceptions without mutation."""
    rules = compile_rules(data)
    exceptions = data.get('exceptions', [])
    if not isinstance(exceptions, list):
        raise ValueError('exceptions must be a list')
    by_key, problems, signatures = {}, [], set()
    for index, entry in enumerate(exceptions):
        key = (entry.get('path'), entry.get('rule'))
        kind = entry.get('kind', 'file')
        path = entry.get('path', '')
        if (not isinstance(path, str) or path.startswith('/') or '..' in Path(path).parts or
                entry.get('rule') not in rules or not isinstance(entry.get('count'), int) or
                entry['count'] <= 0 or not re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')) or
                not isinstance(entry.get('reason'), str) or not entry['reason'].strip() or
                kind not in ('line', 'file')):
            problems.append(f'invalid exception {index}')
            continue
        # Whole-file allowances apply only to exact, hash-bound predecessor SQL
        # and immutable CI evidence, never a broad test/docs/migration directory.
        if kind == 'file' and not (re.fullmatch(r'crates/nac-core/src/store/schema/fixtures/(?:v[0-9]+(?:-fresh)?|v53-speed|v53-legacy-schedule-replay|v53-legacy-resume-run|v53-admitted-frozen|v55-speed-task|v55-source-task|v55-legacy-command-speed|v5[456]-speed-upgraded)\.sql', path)
                                   or path.startswith('docs/ci/evidence/')):
            problems.append(f'whole-file exception forbidden: {path}')
            continue
        signature = (key, kind, entry['sha256'])
        if signature in signatures or any(old.get('kind', 'file') != kind for _, old in by_key.get(key, [])):
            problems.append(f'duplicate or overlapping exception: {path} [{key[1]}]')
            continue
        signatures.add(signature)
        by_key.setdefault(key, []).append((index, entry))

    used = set()
    matches = {}
    for path, raw in sorted(files.items()):
        if path in METADATA or b'\0' in raw:
            continue
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            continue
        for name, pattern in rules.items():
            lines = [(line, len(pattern.findall(line))) for line in text.splitlines() if pattern.search(line)]
            remaining = sum(count for _, count in lines)
            if not remaining:
                continue
            matches[(path, name)] = remaining
            candidates = by_key.get((path, name), [])
            for index, entry in candidates:
                if entry.get('kind', 'file') == 'file':
                    if sha(raw) == entry['sha256'] and remaining == entry['count']:
                        used.add(index)
                        remaining = 0
                else:
                    selected = sum(count for line, count in lines if sha(line.strip().encode()) == entry['sha256'])
                    if selected == entry['count']:
                        used.add(index)
                        remaining -= selected
            if remaining:
                problems.append(f'{path}: {name}: {remaining} unclassified match(es)')
    for index, entry in enumerate(exceptions):
        if index not in used:
            problems.append(f"stale or unmatched exception: {entry.get('path')} [{entry.get('rule')}]")
    return problems, matches


def baseline_problems(manifest, tracked, uncovered, matched):
    if manifest.get('revision') != BASELINE_REVISION or not isinstance(manifest.get('paths'), list):
        return ['invalid baseline inventory']
    entries = manifest['paths']
    names = [row.get('path', '') for row in entries]
    if (names != sorted(set(names)) or
            sha(('\n'.join(names) + '\n').encode()) != BASELINE_ROSTER_SHA256):
        return ['baseline path roster changed; reproduce all three inventories before updating the bound digest']
    problems = []
    for row in entries:
        path, disposition = row['path'], row.get('disposition')
        if disposition == 'pending':
            problems.append(f'{path}: baseline disposition pending')
        elif disposition == 'deleted':
            if path in tracked:
                problems.append(f'{path}: baseline says deleted but path exists')
        elif disposition == 'neutralized':
            if path not in tracked or path in matched:
                problems.append(f'{path}: neutralized disposition requires tracked content without matching retirement rules')
        elif disposition in ('historical', 'unrelated'):
            if path not in tracked or not row.get('reason') or path in uncovered or path not in matched:
                problems.append(f'{path}: {disposition} disposition requires a reason and fully classified, still-matching content')
        else:
            problems.append(f'{path}: invalid baseline disposition')
    return problems


def main():
    paths = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).split(b'\0')
    tracked = {p.decode('utf-8') for p in paths if p}
    files = {}
    for name in sorted(tracked - METADATA):
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            print(f'{name}: tracked path unavailable or a symlink', file=sys.stderr)
            return 1
        files[name] = path.read_bytes()
    data = json.loads((ROOT / DIRECTORY / 'rules.json').read_text())
    baseline = json.loads((ROOT / DIRECTORY / 'baseline-paths.json').read_text())
    problems, matches = audit(files, data)
    unclassified = {line.split(': ', 1)[0] for line in problems}
    problems += baseline_problems(baseline, tracked, unclassified, {path for path, _ in matches})
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        print(f'direct retirement guard: {len(problems)} unresolved finding(s)', file=sys.stderr)
        return 1
    print('direct retirement guard: tracked source, shipped text, and baseline dispositions are classified')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
