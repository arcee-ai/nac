"""Pure negative controls; never invokes the canonical writers."""
import importlib.util
import os
from pathlib import Path
import subprocess
import json
import tempfile
import unittest
from unittest.mock import patch, Mock, call

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('canonical_generation', HERE / 'canonical-generation.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
C = 'a' * 40


def workflow_contract(text):
    import re
    matches = list(re.finditer(r'^  ([a-z][a-z0-9-]*):\n', text, re.M))
    jobs = {m.group(1): text[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(text)]
            for i, m in enumerate(matches)}
    exclusion = "!(github.event_name == 'workflow_dispatch' && inputs.canonical_generation == true)"
    for name in ('prepare', 'quality', 'test', 'required-pr-checks', 'publish'):
        guard = jobs[name].split('    runs-on:', 1)[0]
        if exclusion not in guard:
            raise ValueError(name)
    if not re.search(r'canonical_generation:\n(?:.*\n){0,4}        default: false', text):
        raise ValueError('default')


class Guards(unittest.TestCase):
    def test_exact_context(self):
        good = ['workflow_dispatch', module.REF, C, C, C]
        module.context(*good)
        for index, value in enumerate(('push', 'refs/heads/main', 'b' * 40, 'c' * 40, '')):
            bad = good.copy()
            bad[index] = value
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                module.context(*bad)

    def test_no_ambient_credentials_or_profile(self):
        parent = {'PATH': '/bin', 'GH_TOKEN': 'secret', 'OPENAI_API_KEY': 'secret',
                  'CARGO_PROFILE_DEV_DEBUG': '0', 'GITHUB_TOKEN': 'secret',
                  'RUSTFLAGS': '--cfg bypass', 'HOME': '/ambient', 'RUSTUP_HOME': '/rustup'}
        child = module.child_env(parent, Path('/owned/home'), Path('/owned/target'))
        self.assertFalse(set(child) & {'GH_TOKEN', 'OPENAI_API_KEY', 'GITHUB_TOKEN',
                                      'CARGO_PROFILE_DEV_DEBUG', 'RUSTFLAGS'})
        self.assertEqual(child['HOME'], '/owned/home')
        self.assertEqual(child['RUSTUP_HOME'], '/rustup')

    def test_output_scope(self):
        for name in module.FILES:
            self.assertTrue(module.allowed(name))
        for name in ('/etc/passwd', '../secret', 'Cargo.lock', 'src/lib.rs',
                     module.DIRS[0] + '/../secret', module.DIRS[0] + 'evil/file'):
            self.assertFalse(module.allowed(name), name)

    def test_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            name = module.FILES[0]
            target = root / name
            target.parent.mkdir(parents=True)
            target.symlink_to('/etc/passwd')
            with self.assertRaises(RuntimeError):
                module.regular(root, name)
            target.unlink()
            target.write_bytes(b'canonical')
            os.link(target, root / 'other')
            with self.assertRaises(RuntimeError):
                module.regular(root, name)

    def test_foreign_change(self):
        with patch.object(module, 'git', side_effect=[b'Cargo.lock\0', b'']):
            with self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_SOURCE_CHANGE'):
                module.changed_paths(Path('/unused'))

    def test_source_and_control_identity(self):
        env = {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': module.REF,
               'GITHUB_SHA': C, 'WORKFLOW_SHA': C, 'EXPECTED_CONTROL_SHA': C}
        valid = [C.encode(), (C + ' ' + module.SOURCE).encode(),
                 ('\0'.join(sorted(module.CONTROL_PATHS)) + '\0').encode(),
                 b'', b'', module.SOURCE.encode(), module.TREE.encode()]
        for index, bad in ((0, b'wrong'), (1, b'multiple parents'),
                           (2, b'Cargo.lock\0'), (3, b'dirty'), (4, b'dirty'),
                           (5, b'wrong source'), (6, b'wrong tree')):
            answers = valid.copy()
            answers[index] = bad
            with self.subTest(index=index), patch.object(module, 'git', side_effect=answers):
                with self.assertRaises(RuntimeError):
                    module.validate(Path('/control'), Path('/source'), env)
        with patch.object(module, 'git', side_effect=valid):
            module.validate(Path('/control'), Path('/source'), env)

    def outputs(self, root):
        for name in module.FILES:
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('baseline\n')
        for name in module.DIRS:
            (root / name).mkdir(parents=True, exist_ok=True)
            (root / name / '.keep').write_text('keep')

    def environment(self, root):
        root = root.resolve()
        return {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': module.REF,
                'GITHUB_SHA': C, 'WORKFLOW_SHA': C, 'EXPECTED_CONTROL_SHA': C,
                'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
                'RUNNER_TEMP': str(root), 'GITHUB_OUTPUT': str(root / 'step-output')}

    def bundle(self, root):
        root = root.resolve()
        env = self.environment(root)
        out = root / 'canonical-evidence'
        marker = module.acquire_output(out, env)
        env['OWNERSHIP_NONCE'] = marker['nonce']
        module.write_json(out / 'terminal.json', dict(module.identity(env),
                          kind='canonical-generation-only', success=False, commands=[]))
        module.seal_artifact(out)
        return out, env

    def test_added_and_deleted_in_binary_patch_without_real_index_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / 'repo'
            root.mkdir()
            def git(*args, env=None, data=None):
                return subprocess.check_output(['git', '-C', str(root), *args],
                                               env=env, input=data, stderr=subprocess.DEVNULL)
            git('init', '-q')
            self.outputs(root)
            human = root / 'human.txt'
            human.write_text('unchanged source')
            (root / module.WEB / '.gitignore').write_text('*.tsbuildinfo\n')
            directory = root / module.DIRS[0]
            (directory / 'old.js').write_bytes(b'old\0chunk')
            (directory / 'mod.js').write_bytes(b'old\0content')
            (directory / 'mode.js').write_text('same content')
            git('add', '.')
            sha = git('write-tree').decode().strip()
            original_index = (root / '.git/index').read_bytes()
            before = module.inventory(root)
            (directory / 'old.js').unlink()
            (directory / 'mod.js').write_bytes(b'new\0content')
            (directory / 'mode.js').chmod(0o755)
            (directory / 'new.js').write_bytes(b'new\0chunk')
            ignored = root / module.DIRS[1] / 'new.tsbuildinfo'
            ignored.write_text('ignored allowed addition')
            self.assertTrue(git('check-ignore', str(ignored)).strip())
            accepted = module.inventory(root)
            raw = home / 'raw'
            module.freeze_outputs(root, raw, accepted)
            with patch.object(module, 'SOURCE', sha):
                result, tree = module.output_patch(root, home / 'alternate-index', os.environ,
                                                    raw, accepted, before)
            changes = module.ledger(before, accepted)
            self.assertIn(str(ignored.relative_to(root)), changes)
            self.assertIsNone(changes[str(ignored.relative_to(root))]['before'])
            self.assertIsNone(changes[str((directory / 'old.js').relative_to(root))]['after'])
            self.assertIn(b'deleted file mode', result)
            self.assertIn(b'new file mode', result)
            self.assertIn(b'GIT binary patch', result)
            self.assertIn(b'new mode 100755', result)
            self.assertEqual(module.inventory(raw), accepted)
            # Independent application into a second disposable index reconstructs the same full tree.
            verify_env = dict(os.environ, GIT_INDEX_FILE=str(home / 'verify-index'))
            git('read-tree', sha, env=verify_env)
            git('apply', '--cached', '--binary', env=verify_env, data=result)
            self.assertEqual(git('write-tree', env=verify_env).decode().strip(), tree)
            base = module.tree_entries(root, sha)
            final = module.tree_entries(root, tree)
            self.assertEqual({p: v for p, v in base.items() if not module.allowed(p)},
                             {p: v for p, v in final.items() if not module.allowed(p)})
            self.assertEqual(final[str(ignored.relative_to(root))]['blob'], accepted[str(ignored.relative_to(root))]['blob'])
            self.assertEqual((root / '.git/index').read_bytes(), original_index)
            # A changed raw copy cannot be patched under the accepted map.
            (raw / module.FILES[0]).write_text('late mutation')
            with patch.object(module, 'SOURCE', sha), self.assertRaisesRegex(RuntimeError, 'PATCH_BLOB_DRIFT'):
                module.output_patch(root, home / 'bad-index', os.environ, raw, accepted, before)

    def test_mutation_between_parity_and_export_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.outputs(root)
            accepted = module.inventory(root)
            (root / module.FILES[0]).write_text('changed after inventory')
            with self.assertRaisesRegex(RuntimeError, 'EXPORT_MAP_DRIFT'):
                module.freeze_outputs(root, Path(tmp) / 'raw', accepted)

    def test_ledger_includes_all_records_and_modes(self):
        before = {'deleted': {'mode': '100644'}, 'mode': {'mode': '100644'}, 'same': {'bytes': 1}}
        after = {'added': {'bytes': 2}, 'mode': {'mode': '100755'}, 'same': {'bytes': 1}}
        self.assertEqual(set(module.ledger(before, after)), {'deleted', 'mode', 'added'})

    def test_export_tree_rejects_any_outside_change_or_output_difference(self):
        name = module.FILES[0]
        outside = {'mode': '100644', 'kind': 'blob', 'blob': 'a' * 40}
        accepted = {name: {'mode': '100644', 'blob': 'b' * 40}}
        base = {'human.rs': outside}
        good = dict(base, **{name: dict(accepted[name], kind='blob')})
        module.verify_export_tree(base, good, accepted)
        for bad in (dict(good, **{'human.rs': dict(outside, blob='c' * 40)}),
                    dict(good, **{'extra.rs': outside}),
                    {name: good[name]}, dict(base),
                    dict(good, **{name: dict(good[name], mode='100755')})):
            with self.subTest(bad=bad), self.assertRaises(RuntimeError):
                module.verify_export_tree(base, bad, accepted)

    def test_workflow_mode_guards(self):
        text = (HERE.parent / 'workflows/stable-release.yml').read_text()
        workflow_contract(text)
        exclusion = "!(github.event_name == 'workflow_dispatch' && inputs.canonical_generation == true)"
        for index in range(text.count(exclusion)):
            start = -1
            for _ in range(index + 1):
                start = text.index(exclusion, start + 1)
            with self.subTest(index=index), self.assertRaises(ValueError):
                workflow_contract(text[:start] + 'true' + text[start + len(exclusion):])
        with self.assertRaises(ValueError):
            workflow_contract(text.replace('default: false', 'default: true', 1))
        self.assertEqual(text.count('persist-credentials: false') >= 2, True)
        helper = (HERE / 'canonical-generation.py').read_text()
        self.assertNotIn("('make', 'test-assets')", helper)
        self.assertIn("GEN + GEN", helper)

    def test_upload_guard_detects_extra_and_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, env = self.bundle(Path(tmp))
            module.verify_upload(out, env)  # Correctly owned false terminal is allowed.
            (out / 'credential.txt').write_text('not exportable')
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_PATH'):
                module.verify_upload(out, env)
            (out / 'credential.txt').unlink()
            (out / 'terminal.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_HASH_DRIFT'):
                module.verify_upload(out, env)

    def test_stale_directory_cannot_acquire_or_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, previous = self.bundle(Path(tmp))
            current = self.environment(Path(tmp))
            Path(current['GITHUB_OUTPUT']).write_text('')
            with self.assertRaises(FileExistsError):
                module.acquire_output(out, current)
            self.assertEqual(Path(current['GITHUB_OUTPUT']).read_text(), '')
            with self.assertRaisesRegex(RuntimeError, 'OWNERSHIP_NOT_ACQUIRED'):
                module.verify_upload(out, current)
            self.assertTrue(previous['OWNERSHIP_NONCE'])

    def test_upload_rejects_wrong_current_identity_and_nonce(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, env = self.bundle(Path(tmp))
            for key, value in [('GITHUB_RUN_ID', '124'), ('GITHUB_RUN_ATTEMPT', '3'),
                               ('OWNERSHIP_NONCE', 'b' * 64)]:
                with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'ARTIFACT_OWNERSHIP'):
                    module.verify_upload(out, dict(env, **{key: value}))
            changed = dict(env, GITHUB_SHA='b' * 40, EXPECTED_CONTROL_SHA='b' * 40, WORKFLOW_SHA='b' * 40)
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_OWNERSHIP'):
                module.verify_upload(out, changed)
            terminal = json.loads((out / 'terminal.json').read_text())
            for key in module.identity(env):
                wrong = dict(terminal, **{key: 'wrong'})
                module.write_json(out / 'terminal.json', wrong)
                module.seal_artifact(out)  # Matching self-manifest cannot authorize wrong identity.
                with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'ARTIFACT_IDENTITY'):
                    module.verify_upload(out, env)

    def test_ownership_checked_before_manifest_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, env = self.bundle(Path(tmp))
            (out / 'artifact-manifest.json').unlink()
            (out / 'artifact-manifest.json').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_REGULAR'):
                module.verify_upload(out, env)

    def test_failed_command_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            records = []
            proc = Mock(pid=99999)
            proc.poll.return_value = 7
            with patch.object(module.subprocess, 'Popen', return_value=proc), \
                 patch.object(module, 'retire_group', return_value={'absent': True}), \
                 patch.object(module.shutil, 'disk_usage', return_value=Mock(free=14 * module.GIB)), \
                 patch.object(module.time, 'monotonic', return_value=0), \
                 self.assertRaisesRegex(RuntimeError, 'COMMAND_FAILED'):
                module.run_command(('inert',), root, {}, root / 'log', 1,
                                   14 * module.GIB, records)
            self.assertEqual(records[0]['exit'], 7)
            self.assertTrue(records[0]['group_retirement']['absent'])

    def test_expired_deadline_never_launches_next_command(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(module.subprocess, 'Popen') as popen, \
             patch.object(module.time, 'monotonic', return_value=10):
            with self.assertRaisesRegex(RuntimeError, 'BEFORE_LAUNCH'):
                module.run_command(('never',), Path(tmp), {}, Path(tmp) / 'log', 9, 14 * module.GIB, [])
            popen.assert_not_called()

    def test_successful_leader_with_unretired_group_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = Mock(pid=99999)
            proc.poll.return_value = 0
            records = []
            with patch.object(module.subprocess, 'Popen', return_value=proc), \
                 patch.object(module, 'retire_group', return_value={'absent': False}), \
                 patch.object(module.shutil, 'disk_usage', return_value=Mock(free=14 * module.GIB)), \
                 patch.object(module.time, 'monotonic', return_value=0), \
                 self.assertRaisesRegex(RuntimeError, 'GROUP_NOT_RETIRED'):
                module.run_command(('inert',), Path(tmp), {}, Path(tmp) / 'log', 1,
                                   14 * module.GIB, records)
            self.assertFalse(records[0]['group_retirement']['absent'])

    def test_group_absence_receipt_not_leader_exit(self):
        proc = Mock(pid=99999)
        proc.poll.return_value = 0
        with patch.object(module.os, 'killpg', side_effect=[None, None, ProcessLookupError]) as kill, \
             patch.object(module.time, 'monotonic', return_value=0), patch.object(module.time, 'sleep'):
            receipt = module.retire_group(proc)
        self.assertTrue(receipt['absent'])
        self.assertTrue(receipt['term_sent'])
        self.assertEqual(kill.call_args_list, [call(99999, 0), call(99999, module.signal.SIGTERM), call(99999, 0)])

    def test_group_retirement_has_finite_refusal(self):
        proc = Mock(pid=99999)
        proc.poll.return_value = 0
        with patch.object(module.os, 'killpg'), \
             patch.object(module.time, 'monotonic', side_effect=[0, 6, 6, 6]):
            receipt = module.retire_group(proc)
        self.assertFalse(receipt['absent'])
        self.assertTrue(receipt['kill_sent'])



if __name__ == '__main__':
    unittest.main()
