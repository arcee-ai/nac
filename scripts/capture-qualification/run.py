#!/usr/bin/env python3
"""Reproduce qualification tests + disposable benchmark; emit sanitized JSON."""
import argparse
import datetime
from collections import Counter
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import tarfile
import time
import unittest

from fixtures import Repo
from probe import Probe, digest, history_recipe, physical, source_evidence


def summary(evidence):
    return {'head': evidence['head'], 'index_sha256': evidence['index_sha256'],
            'manifest_sha256': digest(json.dumps(evidence['entries'], sort_keys=True).encode()),
            'entries': len(evidence['entries'])}


def benchmark(count, size, dirty):
    repo = Repo()
    try:
        repo.put('.gitignore', b'ignored/\n')
        for i in range(count):
            # Unique deterministic binary blobs, modestly compressible header.
            data = hashlib.shake_256(f'fixture-{i}'.encode()).digest(size)
            repo.put(f'src/{i // 128:03}/{i:05}.bin', data)
        repo.commit()
        # Build-heavy ignored tree is populated AFTER commit. Inventory must prune.
        for i in range(10000):
            repo.put(f'ignored/build/{i // 100}/{i}', b'excluded' * 128)
        if dirty:
            repo.put('tracked', b'dirty final bytes\0\xff')
            repo.put('untracked', b'ordinary untracked\n')
            (repo.root / 'src/000/00000.bin').unlink()
        before = summary(source_evidence(repo.root))
        rows = []
        for cache in ('first-private-index', 'warm-private-index'):
            start = time.monotonic()
            usage_before = resource.getrusage(resource.RUSAGE_CHILDREN)
            objects_before = physical(repo.root / '.git/objects')
            p = Probe(repo.root)
            selected = p.inspect()
            trace = Path(repo.temp.name) / (cache + '.trace')
            commit = history_recipe(p, repo.root / '.git/benchmark-index', trace)
            git_directory_counts = [int(row['value']) for row in map(json.loads, trace.read_text().splitlines())
                                    if row.get('category') == 'read_directory' and row.get('key') == 'directories-visited']
            assert git_directory_counts and max(git_directory_counts) == len(p.visited_directories)
            q = Probe(repo.root)
            observed = q.inspect()
            assert selected == observed
            assert not any(d.startswith('ignored') for d in p.visited_directories + q.visited_directories)
            wall = time.monotonic() - start
            # Direct tar extraction oracle checks bytes/types/modes; no checkout
            # filters are run. This does not qualify git-worktree materialization.
            capture_commands = list(p.commands) + list(q.commands)
            archive = p.git('archive', '--format=tar', commit)
            retention_start = time.monotonic()
            bundle = Path(repo.temp.name) / (cache + '.bundle')
            p.git('bundle', 'create', str(bundle), 'refs/nac/qualification')
            retention_seconds = time.monotonic() - retention_start
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                actual = {}
                for member in tar:
                    if member.isdir():
                        continue
                    data = os.fsencode(member.linkname) if member.issym() else tar.extractfile(member).read()
                    mode = '120000' if member.issym() else ('100755' if member.mode & 0o111 else '100644')
                    actual[member.name] = {'mode': mode, 'sha256': digest(data), 'size': len(data)}
            expected = {name: entry for name, entry in selected['entries'].items() if entry is not None}
            assert actual == expected
            usage_after = resource.getrusage(resource.RUSAGE_CHILDREN)
            after = summary(source_evidence(repo.root))
            assert before == after
            rows.append({'cache': cache, 'capture_validation_wall_seconds': round(wall, 4),
                         'git_commands_capture_validation': len(capture_commands),
                         'command_counts': dict(Counter(cmd[0] for cmd in capture_commands)),
                         'oracle_visited_directories': p.visited_directories,
                         'git_trace2_directories_visited': git_directory_counts,
                         'ignored_tree_visited': any(d.startswith('ignored') for d in p.visited_directories + q.visited_directories),
                         'candidates': len(selected['entries']),
                         'selected_logical_bytes': sum(e['size'] for e in expected.values()),
                         'oracle_bytes_read_two_passes': p.bytes_read + q.bytes_read,
                         'archive_bytes': len(archive),
                         'independent_bundle_bytes': bundle.stat().st_size,
                         'independent_bundle_physical': bundle.stat().st_blocks * 512,
                         'bundle_retention_wall_seconds': round(retention_seconds, 4),
                         'git_objects_physical_before': objects_before,
                         'git_objects_physical_after': physical(repo.root / '.git/objects'),
                         'private_index_physical': (repo.root / '.git/benchmark-index').stat().st_blocks * 512,
                         'child_os_input_blocks': usage_after.ru_inblock - usage_before.ru_inblock,
                         'child_os_output_blocks': usage_after.ru_oublock - usage_before.ru_oublock,
                         'source_before': before, 'source_after': after,
                         'materialized_manifest_equal': actual == expected})
        return {'fixture': f'{count}-files-{size}-bytes', 'dirty': dirty,
                'ignored_files': 10000, 'ignored_logical_bytes': 10000 * 1024,
                'runs': rows}
    finally:
        repo.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), 'test_*.py')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    def command(*args):
        return subprocess.check_output(args, text=True).strip()
    report = {'schema': 1, 'qualification_verdict': 'FAIL',
              'subject_revision': '90be848ba3f0410b5e697bb60f4d71a935216361',
              'repository_head_at_measurement': command('git', 'rev-parse', 'HEAD'),
              'measured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'runner_source_sha256': {p.name: digest(p.read_bytes()) for p in sorted(Path(__file__).parent.glob('*.py'))},
              'environment': {'platform': platform.platform(), 'machine': platform.machine(),
                              'cpu': command('sysctl', '-n', 'machdep.cpu.brand_string') if platform.system() == 'Darwin' else platform.processor(),
                              'memory_bytes': command('sysctl', '-n', 'hw.memsize') if platform.system() == 'Darwin' else 'unrecorded',
                              'git': command('git', '--version'), 'python': platform.python_version(),
                              'cache': 'OS cache warm after fixture creation; no cache purge; first/warm PRIVATE index only'},
              'oracle_tests_passed': result.testsRun,
              'benchmarks': [benchmark(n, size, dirty) for n, size in ((24, 1024), (4096, 8192))
                             for dirty in (False, True)]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Wrote {args.output}; FAIL is the subject qualification verdict, not runner failure.')


if __name__ == '__main__':
    main()
