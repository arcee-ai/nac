"""Executable oracle/rejection/race fixtures; not production capture acceptance."""
import dataclasses
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import unittest

from fixtures import Repo
from probe import Limits, Probe, Rejected, history_recipe, source_evidence, validate_twice


class Contract(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.root = self.repo.root
        self.addCleanup(self.repo.close)

    def files(self):
        from probe import digest
        import stat
        result = {}
        for directory, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = [name for name in dirs if name != '.git']
            for name in files + [name for name in dirs if (Path(directory) / name).is_symlink()]:
                path = Path(directory) / name
                mode = path.lstat().st_mode
                if stat.S_ISLNK(mode):
                    data = os.fsencode(os.readlink(path))
                elif stat.S_ISREG(mode) and mode & 0o444:
                    data = path.read_bytes()
                else:
                    data = b'<unreadable-or-special>'
                result[str(path.relative_to(self.root))] = (mode, digest(data))
        return result

    def reject(self, reason, fn=None):
        before_files = self.files()
        before_head = self.repo.git('rev-parse', 'HEAD')
        before_index = (self.root / '.git/index').read_bytes()
        with self.assertRaisesRegex(Rejected, reason):
            (fn or (lambda: Probe(self.root).inspect()))()
        self.assertEqual(self.repo.git('rev-parse', 'HEAD'), before_head)
        self.assertEqual((self.root / '.git/index').read_bytes(), before_index)
        self.assertEqual(self.files(), before_files)

    def test_supported_bytes_deletes_renames_mode_staging_nested_cwd(self):
        self.repo.put('old', b'rename')
        self.repo.commit()
        self.repo.put('tracked', b'staged')
        self.repo.git('add', 'tracked')
        self.repo.put('tracked', b'disk\0\xff')
        (self.root / 'old').rename(self.root / 'new')
        self.repo.put('exec', b'#!/bin/sh\n')
        (self.root / 'exec').chmod(0o755)
        self.repo.put('nested/binary', bytes(range(256)))
        os.symlink('nested', self.root / 'directory-link')
        os.symlink('missing\n', self.root / 'dangling')
        before = source_evidence(self.root)
        data = validate_twice(self.root)
        self.assertEqual(source_evidence(self.root), before)
        self.assertIsNone(data['entries']['old'])
        self.assertEqual(data['entries']['tracked']['size'], 6)
        self.assertEqual(data['entries']['exec']['mode'], '100755')
        self.assertEqual(data['entries']['directory-link']['mode'], '120000')
        self.assertEqual(data['entries']['dangling']['size'], 8)
        self.assertEqual(self.repo.git('-C', 'nested', 'rev-parse', '--show-toplevel').strip(),
                         os.fsencode(self.root.resolve()))

    def test_deleted_parent_directory_is_a_tracked_deletion(self):
        self.repo.put('removed/file', b'deleted')
        self.repo.commit()
        shutil.rmtree(self.root / 'removed')
        before = source_evidence(self.root)
        manifest = validate_twice(self.root)
        self.assertIsNone(manifest['entries']['removed/file'])
        p = Probe(self.root)
        commit = history_recipe(p, self.root / '.git/deletion-index')
        self.assertNotIn(b'removed/file', self.repo.git('ls-tree', '-r', commit))
        self.assertEqual(source_evidence(self.root), before)

    def test_ignored_tracked_and_unreadable_ignored_nested_tree(self):
        self.repo.put('.gitignore', b'tracked\nignored/\n')
        self.repo.put('ignored/nested/.git/secret', b'excluded')
        (self.root / 'ignored').chmod(0)
        entries = Probe(self.root).inspect()['entries']
        self.assertIn('tracked', entries)
        self.assertEqual(set(entries), {'tracked', '.gitignore'})

    def test_git_trace_prunes_ignored_directory_subtree(self):
        import json
        self.repo.put('.gitignore', b'ignored/\n')
        self.repo.put('visible/file', b'visible')
        for i in range(128):
            self.repo.put(f'ignored/deep/{i}/file', b'excluded')
        trace = Path(self.repo.temp.name) / 'trace'
        Probe(self.root).git('ls-files', '--others', '--exclude-standard', '-z',
                             env={'GIT_TRACE2_EVENT': str(trace)})
        counts = [int(row['value']) for row in map(json.loads, trace.read_text().splitlines())
                  if row.get('category') == 'read_directory' and row.get('key') == 'directories-visited']
        self.assertEqual(counts, [2])  # root + visible, never ignored/deep/...

    def test_absolute_link(self):
        os.symlink('/outside', self.root / 'bad')
        self.reject('absolute-link:bad')

    def test_escaping_link(self):
        os.symlink('../outside', self.root / 'bad')
        self.reject('escaping-link:bad')

    def test_link_chain(self):
        os.symlink('tracked', self.root / 'first')
        os.symlink('first', self.root / 'second')
        self.reject('link-chain:second')

    def test_link_chain_with_directory_component(self):
        self.repo.put('dir/file', b'data')
        os.symlink('dir', self.root / 'alias')
        os.symlink('alias/file', self.root / 'bad')
        self.reject('link-chain:bad')

    def test_parent_link_never_reads_external_content(self):
        outside = Path(self.repo.temp.name) / 'outside'
        outside.mkdir()
        (outside / 'secret').write_bytes(b'secret')
        os.symlink(outside, self.root / 'parent')
        self.reject('path-or-read:parent/secret', lambda: Probe(self.root).read_entry(b'parent/secret'))

    def test_invalid_parent_path(self):
        self.reject('unsupported:path:', lambda: Probe(self.root).read_entry(b'../secret'))

    def test_nested_repository(self):
        self.repo.put('nested/.git/HEAD', b'ref: refs/heads/main\n')
        self.repo.put('nested/file', b'nested')
        # Real initialized repo, not a fake malformed Git admin directory.
        subprocess.run(['git', 'init', '-q', str(self.root / 'nested')], check=True)
        self.reject('nested-repository|unsupported:type:nested')

    def test_gitlink(self):
        head = self.repo.git('rev-parse', 'HEAD').strip().decode()
        self.repo.git('update-index', '--add', '--cacheinfo', f'160000,{head},module')
        self.reject('gitlink:module')

    def test_sparse(self):
        self.repo.git('config', 'core.sparseCheckout', 'true')
        self.reject('sparse-checkout')

    def test_unmerged(self):
        oid = self.repo.git('rev-parse', 'HEAD:tracked').strip()
        self.repo.git('update-index', '--index-info', data=b'100644 ' + oid + b' 1\tconflict\n')
        self.reject('unmerged-index')

    def test_fifo(self):
        os.mkfifo(self.root / 'pipe')
        self.reject('unsupported:type:pipe')

    def test_socket(self):
        sock = socket.socket(socket.AF_UNIX)
        self.addCleanup(sock.close)
        sock.bind(str(self.root / 'socket'))
        self.reject('unsupported:type:socket')

    def test_device_type_without_privileged_device_creation(self):
        # Type policy only: a real device cannot be created unprivileged here.
        from unittest.mock import patch
        import stat
        metadata = (self.root / 'tracked').stat()
        fake = os.stat_result((stat.S_IFCHR | 0o600, *metadata[1:]))
        with patch('probe.os.stat', return_value=fake):
            self.reject('unsupported:type:tracked', lambda: Probe(self.root).read_entry(b'tracked'))

    def test_unreadable(self):
        (self.root / 'tracked').chmod(0)
        self.addCleanup((self.root / 'tracked').chmod, 0o644)
        self.reject('unreadable:tracked')

    def test_attributes_reject_before_external_filter_can_execute(self):
        sentinel = Path(self.repo.temp.name) / 'FILTER_EXECUTED'
        # A poison command MUST NOT run, even to determine whether it transforms.
        self.repo.git('config', 'filter.poison.clean', f'touch {sentinel}; cat')
        self.repo.git('config', 'filter.poison.smudge', f'touch {sentinel}; cat')
        self.repo.put('.gitattributes', b'tracked filter=poison\n')
        self.reject('attribute:tracked:filter')
        self.assertFalse(sentinel.exists())

    def test_content_transform_categories(self):
        for attribute in ('text', 'text=auto', 'eol=lf', 'working-tree-encoding=UTF-16', 'ident', 'filter=lfs'):
            with self.subTest(attribute=attribute):
                self.repo.put('.gitattributes', ('tracked ' + attribute + '\n').encode())
                self.reject('attribute:tracked:')
        (self.root / '.gitattributes').unlink()
        self.repo.git('config', 'core.autocrlf', 'true')
        self.reject('core.autocrlf')

    def test_deterministic_head_pathset_content_type_link_mode_changes(self):
        mutations = {
            'head': lambda: self.repo.git('commit', '--allow-empty', '-qm', 'head moved'),
            'add': lambda: self.repo.put('added', b'new'),
            'delete': lambda: (self.root / 'tracked').unlink(),
            'content': lambda: self.repo.put('tracked', b'changed'),
            'type': lambda: ((self.root / 'tracked').unlink(), os.symlink('missing', self.root / 'tracked')),
            'link': lambda: ((self.root / 'link').unlink(), os.symlink('other', self.root / 'link')),
            'mode': lambda: (self.root / 'tracked').chmod(0o755),
        }
        os.symlink('missing', self.root / 'link')
        for name, mutation in mutations.items():
            with self.subTest(name=name):
                # Reset each owned fixture to its own initial state, not a user tree.
                before = (self.root / 'tracked').read_bytes()
                if name == 'link':
                    old_link = os.readlink(self.root / 'link')
                with self.assertRaisesRegex(Rejected, 'conflict:source-changed'):
                    validate_twice(self.root, mutation)
                if (self.root / 'tracked').is_symlink():
                    (self.root / 'tracked').unlink()
                self.repo.put('tracked', before)
                (self.root / 'tracked').chmod(0o644)
                if name == 'link':
                    (self.root / 'link').unlink()
                    os.symlink(old_link, self.root / 'link')

    def test_aba_between_validation_passes_is_not_detected(self):
        def transient():
            self.repo.put('tracked', b'transient')
            self.repo.put('tracked', b'base\n')
        # Demonstrates a limitation, not evidence of OS atomicity.
        validate_twice(self.root, transient)

    def test_each_numeric_bound_below_at_above(self):
        for field, boundary in [('candidates', 1), ('per_file', 5), ('aggregate', 5)]:
            for offset in (-1, 0, 1):
                with self.subTest(field=field, offset=offset):
                    limits = dataclasses.replace(Limits(), **{field: boundary + offset})
                    if offset < 0:
                        self.reject('limit:', lambda: Probe(self.root, limits).inspect())
                    else:
                        Probe(self.root, limits).inspect()
        for elapsed in (29.0, 30.0, 30.001):
            clock = iter([0.0, elapsed])
            p = Probe(self.root, clock=lambda: next(clock))
            if elapsed > 30:
                with self.assertRaisesRegex(Rejected, 'elapsed'):
                    p.check()
            else:
                p.check()

    def test_recommended_default_count_and_byte_boundaries(self):
        # Actual proposed defaults, not just scaled examples. Missing tracked
        # entries count as candidates; deleted bytes contribute zero data.
        oid = self.repo.git('rev-parse', 'HEAD:tracked').strip()
        for count in (9999, 10000, 10001):
            records = b''.join(b'100644 ' + oid + b'\t' + f'missing-{i:05}'.encode() + b'\n'
                               for i in range(count - 1))
            self.repo.git('read-tree', 'HEAD')
            self.repo.git('update-index', '--index-info', data=records)
            if count > 10000:
                self.reject('limit:candidates')
            else:
                self.assertEqual(len(Probe(self.root).inspect()['entries']), count)
        self.repo.git('read-tree', 'HEAD')
        for size in (Limits().per_file - 1, Limits().per_file, Limits().per_file + 1):
            self.repo.put('tracked', b'x' * size)
            if size > Limits().per_file:
                self.reject('limit:per-file')
            else:
                self.assertEqual(Probe(self.root).inspect()['entries']['tracked']['size'], size)
        for aggregate in (Limits().aggregate - 1, Limits().aggregate, Limits().aggregate + 1):
            # Eight full-size files plus one spill byte when above aggregate.
            left = aggregate
            index = 0
            (self.root / 'tracked').unlink(missing_ok=True)
            while left:
                size = min(left, Limits().per_file)
                self.repo.put(f'budget/{index}', b'x' * size)
                left -= size
                index += 1
            if aggregate > Limits().aggregate:
                self.reject('limit:aggregate')
            else:
                p = Probe(self.root)
                p.inspect()
                self.assertEqual(p.bytes_read, aggregate)

    def test_cancel_and_supervised_process_timeout_preserve_source(self):
        before = source_evidence(self.root)
        p = Probe(self.root)
        p.cancelled = True
        self.reject('cancelled', p.inspect)
        # A supervised Git child that blocks; no unsupported capture filter.
        self.repo.git('config', 'alias.block', '!exec sleep 60')
        p = Probe(self.root, dataclasses.replace(Limits(), seconds=.1))
        self.reject('limit:elapsed', lambda: p.git('block'))
        self.assertEqual(source_evidence(self.root), before)

    def test_checkpoint_pin_restart_bundle_and_source_loss(self):
        before = source_evidence(self.root)
        p = Probe(self.root)
        p.inspect()
        commit = history_recipe(p, self.root / '.git/private-index')
        bundle = Path(self.repo.temp.name) / 'retained.bundle'
        self.repo.git('bundle', 'create', str(bundle), 'refs/nac/qualification')
        self.repo.git('gc', '--prune=now')
        # New process reads the same pinned object (simulates lost response).
        self.assertEqual(self.repo.git('show', commit + ':tracked'), b'base\n')
        self.assertEqual(source_evidence(self.root), before)
        self.repo.put('tracked', b'new source')
        self.assertEqual(self.repo.git('show', commit + ':tracked'), b'base\n')
        shutil.rmtree(self.root)
        with self.assertRaises((Rejected, FileNotFoundError)):
            Probe(self.root).inspect()
        recovered = Path(self.repo.temp.name) / 'recovered'
        subprocess.run(['git', 'init', '-q', '--bare', str(recovered)], check=True)
        subprocess.run(['git', '--git-dir', str(recovered), 'bundle', 'unbundle', str(bundle)],
                       check=True, stdout=subprocess.PIPE)
        result = subprocess.run(['git', '--git-dir', str(recovered), 'show', commit + ':tracked'],
                                check=True, stdout=subprocess.PIPE)
        self.assertEqual(result.stdout, b'base\n')

    def test_interruption_boundaries_fake_admission_never_recaptures(self):
        # Isolated admission observer only; no NAC service or request engine.
        admission = Path(self.repo.temp.name) / 'admissions'
        for phase in ('before-object', 'object-unpinned', 'pinned-unacknowledged', 'complete'):
            with self.subTest(phase=phase):
                self.repo.put('tracked', b'base\n')
                worker = """
import sys
from probe import Probe, history_recipe
from pathlib import Path
root, phase = Path(sys.argv[1]), sys.argv[2]
p = Probe(root)
if phase != 'before-object':
    oid = p.git('hash-object', '-w', '--stdin', data=b'base\\n').strip().decode()
if phase in ('pinned-unacknowledged', 'complete'):
    commit = history_recipe(p, root / '.git/interrupted-index')
    print(commit, flush=True)
else:
    print('incomplete', flush=True)
# deterministic barrier: parent kills before acknowledgement, no sleeps
sys.stdin.read()
"""
                child = subprocess.Popen([sys.executable, '-c', worker, str(self.root), phase],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         cwd=Path(__file__).parent)
                checkpoint = child.stdout.readline().strip().decode()
                child.kill()
                child.communicate()
                self.repo.put('tracked', b'newer after interruption')
                # New admission process cannot capture: only accepts retained OID
                # plus explicit complete proof. Pinned alone is not proof.
                proof = phase == 'complete'
                result = subprocess.run([sys.executable, '-c', """
import subprocess, sys
from pathlib import Path
root, oid, proof, receipt = sys.argv[1:]
if proof != 'True' or oid == 'incomplete':
    print('failed:incomplete'); sys.exit(0)
blob = subprocess.check_output(['git', '-C', root, 'show', oid + ':tracked'])
assert blob == b'base\\n'
path = Path(receipt)
if not path.exists(): path.write_text(oid)
assert path.read_text() == oid
print('admitted-original')
""", str(self.root), checkpoint, str(proof), str(admission)], check=True, stdout=subprocess.PIPE)
                self.assertIn(b'admitted-original' if proof else b'failed:incomplete', result.stdout)
                if not proof:
                    self.assertFalse(admission.exists())
                else:
                    self.assertEqual(admission.read_text(), checkpoint)


if __name__ == '__main__':
    unittest.main()
