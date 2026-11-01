"""Command/source/schema controller checks; no compiler or native executable runs."""
import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

from attention_feed_build import (COMMON_SOURCES, SWIFT_PROGRAMS, swift_commands,
                                  source_binding, producer_receipts, build_environment, completion_envelope)
from attention_feed_contract import serializer_envelope, completion_frame

OWNER = Path(__file__).resolve().parent
ROOT = OWNER.parent.parent


class ProgramContracts(unittest.TestCase):
    def test_cli_imports_do_not_create_untracked_cache_before_source_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for file in ('attention_feed_contract.py', 'attention_feed_build.py'):
                shutil.copyfile(OWNER / file, root / file)
            result = subprocess.run([sys.executable, str(root / 'attention_feed_contract.py'), '--help'],
                capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('--source-ref', result.stdout)
            self.assertFalse((root / '__pycache__').exists())

    def test_named_main_and_dependencies_match_both_compile_and_typecheck_paths(self):
        commands = swift_commands('swiftc', '/SDK', OWNER, Path('/private/fixture'))
        checks = swift_commands('swiftc', '/SDK', OWNER, Path('/private/fixture'), typecheck=True)
        for name, sources in SWIFT_PROGRAMS.items():
            files = [OWNER / source for source in sources]
            mains = [path.name for path in files if re.search(r'^@main\b', path.read_text(), re.M)]
            self.assertEqual(mains, {'pure': ['AttentionFeedTests.swift'],
                'http': ['AttentionFeedHTTPFixture.swift'], 'completions': ['AttentionCompletionTests.swift'],
                'indicator': ['NativeAttentionIndicatorTests.swift']}[name])
            self.assertEqual([arg for arg in commands[name] if arg.endswith('.swift')], list(map(str, files)))
            self.assertEqual([arg for arg in checks[name] if arg.endswith('.swift')], list(map(str, files)))
            self.assertEqual(commands[name][-2:], ['-o', '/private/fixture/' + name])
            self.assertIn('-typecheck', checks[name]); self.assertNotIn('-o', checks[name])
            self.assertIn('-warnings-as-errors', commands[name])
        for name in ('pure', 'http', 'indicator'):
            self.assertTrue(set(COMMON_SOURCES).issubset(SWIFT_PROGRAMS[name]))
        self.assertIn('AttentionProjection.swift', SWIFT_PROGRAMS['http'])

    def test_actual_generated_frame_contract_and_both_completion_limits(self):
        schema = json.loads((ROOT / 'crates/nac-server/web/openapi.json').read_text())['components']['schemas']
        proof = completion_envelope(schema)
        self.assertLess(proof['byte_limited_worst_id_rows'], 128)
        self.assertLessEqual(proof['byte_limited_frame_bytes'], proof['native_completion_frame_cap'])
        self.assertLessEqual(proof['row_limited_frame_bytes'], proof['native_completion_frame_cap'])
        altered = copy.deepcopy(schema)
        altered['AttentionFrame']['oneOf'] = [frame for frame in altered['AttentionFrame']['oneOf']
            if frame['properties']['kind']['enum'] != ['completions']]
        with self.assertRaises(StopIteration): completion_envelope(altered)
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'envelope.json'
            serializer_envelope(output)
            self.assertEqual(json.loads(output.read_text())['completion'], proof)

    def test_semantic_test_frames_keep_independent_cursor_and_nullable_item_contract(self):
        store = '10000000-0000-0000-0000-000000000001'
        for n, args in [(0, dict(baseline=True)), (1, dict(more=True)), (2, {})]:
            frame = completion_frame(store, n, **args).decode()
            self.assertNotIn('\nid:', frame)
            page = json.loads(frame.split('data: ', 1)[1])['page']
            self.assertEqual(page['store_id'], store); self.assertEqual(page['cursor'], n)
            if n == 0: self.assertEqual(page['items'], [])
            else:
                self.assertIsNone(page['items'][0]['goal_id'])
                self.assertIsNone(page['items'][0]['mark_version'])

    def test_v5_build_contract_does_not_request_old_four_job_lease(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(build_environment(dict(CARGO_TARGET_DIR=root, CARGO_BUILD_JOBS='2')), Path(root).resolve())
            for jobs in ('4', '0', '', '-2'):
                with self.assertRaises(AssertionError): build_environment(dict(CARGO_TARGET_DIR=root, CARGO_BUILD_JOBS=jobs))
            with self.assertRaises(KeyError): build_environment(dict(CARGO_BUILD_JOBS='2'))


class SourceBindingContracts(unittest.TestCase):
    def test_exact_current_ref_accepts_new_rust_source_and_rejects_dirty_or_different_candidates(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.STDOUT).strip()
            git('init', '--quiet')
            source = root / 'Cargo.toml'; source.write_text('[workspace]\n')
            git('add', 'Cargo.toml')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'First')
            first = git('rev-parse', 'HEAD')
            binding = source_binding(root, first)
            self.assertEqual(binding['source_tree'], git('rev-parse', 'HEAD^{tree}'))
            source.write_text('[workspace]\nmembers=[]\n')
            with self.assertRaises(AssertionError): source_binding(root, first)
            git('add', 'Cargo.toml')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'New Rust graph')
            current = git('rev-parse', 'HEAD')
            self.assertEqual(source_binding(root, current)['source_revision'], current)
            with self.assertRaises(AssertionError): source_binding(root, first)
            with self.assertRaises(AssertionError): source_binding(root, 'HEAD')
            (root / 'uncommitted.swift').write_text('unbound fixture source')
            with self.assertRaises(AssertionError): source_binding(root, current)

    def test_producer_hash_source_tree_embedded_identity_and_mode_guards_stay_effective(self):
        with tempfile.TemporaryDirectory() as temporary:
            binding = dict(source_revision='a'*40, source_tree='b'*40)
            entries = []
            for mode in ('ordinary', 'review'):
                path = Path(temporary) / mode; path.write_bytes(b'Explicit nonexecutable unit fixture bytes')
                entries.append(dict(mode=mode, binary=str(path), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    source_binding=binding.copy(), identity=dict(source_revision='a'*40, build_id=mode)))
            identities = {row['binary']: row['identity'] for row in entries}
            inspect = lambda path: identities[str(path)]
            self.assertEqual(set(producer_receipts(entries, binding, inspect)), {'ordinary', 'review'})
            for key, value in [('sha256', '0'*64), ('source_binding', dict(source_revision='c'*40, source_tree='b'*40)),
                               ('source_binding', dict(source_revision='a'*40, source_tree='c'*40)), ('identity', dict(source_revision='c'*40))]:
                bad = copy.deepcopy(entries); bad[0][key] = value
                with self.assertRaises(AssertionError): producer_receipts(bad, binding, inspect)
            bad = copy.deepcopy(entries); bad[1]['mode'] = 'ordinary'
            with self.assertRaises(AssertionError): producer_receipts(bad, binding, inspect)
            bad = copy.deepcopy(entries)
            for row in bad: row['identity']['source_revision'] = 'c'*40
            with self.assertRaises(AssertionError):
                producer_receipts(bad, binding, lambda path: next(row['identity'] for row in bad if row['binary'] == str(path)))


if __name__ == '__main__':
    unittest.main()
