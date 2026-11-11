"""Pure command protocol and mocked launcher routing; never acquire OS actors."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

import ci_commands as commands
import smoke


def fixture():
    binding = {'source': 'a' * 40, 'native_sha256': 'b' * 64, 'engine_sha256': 'c' * 64}
    identity = {**binding, 'episode': str(uuid.uuid4()), 'pid': 123, 'window': 456,
                **{name: str(uuid.uuid4()) for name in ('launch', 'view', 'document')}}
    attempts = [{**identity, 'version': 1, 'sequence': index + 1, 'phase': name,
                 'kind': 'attempted', 'verified_phases': list(commands.PHASES[:index])}
                for index, name in enumerate(commands.PHASES)]
    final = {**attempts[-1], 'kind': 'finished', 'accepted': True,
             'verified_phases': list(commands.PHASES)}
    driver = {'version': 1, 'configuration_sha256': 'd' * 64, 'attempts': attempts}
    record = {'scenario': 'commands-input', 'passed': True, 'app_pid': 123, 'engine_pid': 124,
              'ready_source': binding['source'], 'profile': '/inert/removed',
              **{name: True for name in ('engine_reaped', 'profile_removed', 'identity_retired', 'commands_retired')}}
    record['commands'] = {**{name: True for name in ('settings_once', 'new_session_once',
        'shared_focus_restored', 'projects_once_same_document', 'foreign_window_rejected',
        'navigation_popup_restricted', 'document_replaced', 'retired', 'trusted_keyboard_edit_qualified')},
        'initial_bridge': {'binding': {name: identity[name] for name in ('launch', 'view', 'document')}},
        'input': {'source': 'external-public-OS-driver', 'app_event_post_access_required': False,
                  'target_pid': 123, 'target_window': 456,
                  **{name: True for name in ('copy_cut_paste_select_undo_redo', 'keyboard_settings_once',
                                            'keyboard_new_session_once', 'keyboard_focus_restored')},
                  'trusted_events': [{'type': name, 'trusted': True} for name in ('keydown', 'input', 'paste')]}}
    return record, final, driver, binding, 'd' * 64


class CommandEvidenceTests(unittest.TestCase):
    def test_publisher_transient_settled_and_coalesced_next_ready_contract(self):
        # Characterize producer frames and their source consumer shape; this
        # deliberately does not claim to execute Swift without an SDK admission.
        root = Path(__file__).parent
        actor = (root / 'NativeUITests/NativeJourneys.swift').read_text()
        producer = (root / 'NativeCommandInput.swift').read_text()
        self.assertIn('try write(kind: "settled", accepted: true)', producer)
        self.assertIn('keys.union(settled ? ["accepted"] : [])', actor)
        self.assertIn('(settled ? phase.accepted == true : phase.accepted == nil)', actor)
        self.assertIn('ready = row; break', actor)
        attempts = fixture()[2]['attempts']
        for index in range(1, 10):
            previous = {**attempts[index - 1], 'kind': 'settled', 'accepted': True,
                        'verified_phases': list(commands.PHASES[:index])}
            following = {**attempts[index], 'kind': 'ready'}
            self.assertEqual(set(previous), set(following) | {'accepted'})
            self.assertEqual(previous['verified_phases'], following['verified_phases'])
            self.assertEqual(previous['sequence'] + 1, following['sequence'])
            for key in commands.IDENTITY: self.assertEqual(previous[key], following[key])
            # Either polling trace reaches the same next ready; settlement is
            # ephemeral and must never be a mandatory observed intermediate.
            for trace in ([previous, following], [following]):
                self.assertEqual(next(row for row in trace if row['kind'] == 'ready'), following)

    def test_atomic_publisher_retirement_preserves_open_phase_inode(self):
        actor = (Path(__file__).parent / 'NativeUITests/NativeJourneys.swift').read_text()
        self.assertIn('(before.st_nlink == 0 || before.st_nlink == 1)', actor)
        self.assertIn('(after.st_nlink == 0 || after.st_nlink == 1)', actor)
        self.assertIn('(before.st_nlink == 1 && after.st_nlink == 0)', actor)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'phase.json'
            original = b'{"kind":"settled","accepted":true}'
            for replace_before_stat in (False, True):
                path.write_bytes(original)
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    if not replace_before_stat: before = os.fstat(fd)
                    temporary = Path(directory) / 'next.json'
                    temporary.write_bytes(b'{"kind":"ready"}')
                    os.replace(temporary, path)
                    if replace_before_stat: before = os.fstat(fd)
                    self.assertIn(before.st_nlink, (0, 1))
                    self.assertEqual(os.read(fd, 4097), original)
                    after = os.fstat(fd)
                    self.assertEqual(after.st_nlink, 0)
                    self.assertEqual(before.st_ino, after.st_ino)
                    self.assertEqual(before.st_size, after.st_size)
                    self.assertEqual(before.st_mtime_ns, after.st_mtime_ns)
                    self.assertEqual(path.read_bytes(), b'{"kind":"ready"}')
                finally: os.close(fd)

    def test_ten_attempts_require_independent_app_settlement(self):
        values = fixture()
        result = commands.require_command_evidence(*values)
        self.assertEqual(result['phases'], list(commands.PHASES))
        for kind in ('ready', 'settled'):
            with self.subTest(kind=kind):
                bad = copy.deepcopy(values)
                bad[1]['kind'] = kind
                with self.assertRaises(RuntimeError): commands.require_command_evidence(*bad)

    def test_each_identity_field_is_bound_in_every_attempt(self):
        for index in range(10):
            for key in commands.IDENTITY:
                with self.subTest(index=index, key=key):
                    values = fixture()
                    values[2]['attempts'][index][key] = 'foreign'
                    with self.assertRaises(RuntimeError): commands.require_command_evidence(*values)

    def test_missing_duplicate_skipped_reordered_or_premature_ack_fails(self):
        for mode in ('missing', 'duplicate', 'reorder', 'sequence', 'bool', 'bool-pid', 'prior-unverified', 'ready', 'extra'):
            with self.subTest(mode=mode):
                values = fixture(); attempts = values[2]['attempts']
                if mode == 'missing': attempts.pop()
                if mode == 'duplicate': attempts[1] = attempts[0]
                if mode == 'reorder': attempts[0], attempts[1] = attempts[1], attempts[0]
                if mode == 'sequence': attempts[1]['sequence'] = 3
                if mode == 'bool': attempts[0]['sequence'] = True
                if mode == 'bool-pid':
                    values[1]['pid'] = 1
                    for attempt in attempts: attempt['pid'] = True
                    values[0]['app_pid'] = 1; values[0]['commands']['input']['target_pid'] = 1
                if mode == 'prior-unverified': attempts[1]['verified_phases'] = []
                if mode == 'ready': attempts[0]['kind'] = 'ready'
                if mode == 'extra': attempts[0]['operation'] = 'arbitrary'
                with self.assertRaises(RuntimeError): commands.require_command_evidence(*values)

    def test_accepted_evidence_file_rejects_symlink_nonregular_and_changed_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record, final, driver, binding, config = fixture()
            value = dict(record=record, final=final, driver=driver, binding=binding,
                         configuration_sha256=config, persistent_authorization_policy_unchanged=True)
            path = root / 'accepted.json'; path.write_text(json.dumps(value))
            self.assertEqual(commands.accepted_case(path, binding), record)
            alias = root / 'alias.json'; alias.symlink_to(path)
            with self.assertRaises(OSError): commands.accepted_case(alias, binding)
            with self.assertRaises((OSError, RuntimeError)): commands.accepted_case(root, binding)
            value['persistent_authorization_policy_unchanged'] = False
            path.write_text(json.dumps(value))
            with self.assertRaises(RuntimeError): commands.accepted_case(path, binding)

    def test_app_acceptance_cleanup_ui_and_trusted_events_cannot_be_replaced_by_ack(self):
        for key in ('passed', 'engine_reaped', 'profile_removed', 'identity_retired', 'commands_retired'):
            values = fixture(); values[0][key] = False
            with self.subTest(key=key), self.assertRaises(RuntimeError): commands.require_command_evidence(*values)
        for key in fixture()[0]['commands']:
            if key in ('initial_bridge', 'input'): continue
            values = fixture(); values[0]['commands'][key] = False
            with self.subTest(key=key), self.assertRaises(RuntimeError): commands.require_command_evidence(*values)
        for mode in ('synthetic', 'no-paste', 'self-post', 'window', 'document', 'config', 'unfinished'):
            values = fixture(); evidence = values[0]['commands']['input']
            if mode == 'synthetic': evidence['trusted_events'][0]['trusted'] = False
            if mode == 'no-paste': evidence['trusted_events'].pop()
            if mode == 'self-post': evidence['app_event_post_access_required'] = True
            if mode == 'window': evidence['target_window'] = 42
            if mode == 'document': values[0]['commands']['initial_bridge']['binding']['document'] = str(uuid.uuid4())
            if mode == 'config': values[2]['configuration_sha256'] = 'e' * 64
            if mode == 'unfinished': values[1]['verified_phases'].pop()
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): commands.require_command_evidence(*values)


class CommandRoutingTests(unittest.TestCase):
    def exercise(self, *, failure=None):
        with tempfile.TemporaryDirectory() as temporary:
            raw = Path(temporary)
            record, final, driver, binding, _ = fixture()
            calls = []
            def run(args, log, timeout, **kwargs):
                calls.append((args, timeout, kwargs))
                if args[-1] == 'smoke-prepare':
                    resources = raw / 'NAC Development Preview Smoke.app/Contents/Resources'
                    resources.mkdir(parents=True)
                    receipt = {'source_head': binding['source'], 'source_dirty': False,
                               'mode': 'smoke-prepare', 'smoke_instrumentation': True,
                               'native_sha256': binding['native_sha256'], 'engine_sha256': binding['engine_sha256']}
                    if failure == 'dirty': receipt['source_dirty'] = True
                    (resources / 'build-receipt.json').write_text(json.dumps(receipt))
                if args[0] == 'python3':
                    self.assertEqual(calls[-2][0][1], 'test-without-building')
                    output = raw / 'evidence'; output.mkdir()
                    rows = [{'scenario': name, 'passed': True} for name in smoke.SCENARIOS]
                    if failure == 'coverage': rows.pop()
                    if failure != 'aggregate':
                        next(row for row in rows if row['scenario'] == 'commands-input')['public_xctest_verified'] = True
                    (output / 'summary.json').write_text(json.dumps({'scenarios': rows, 'full_scenario_run': True}))
            def launcher(case, bounded, command, **options):
                self.assertEqual(options['scenario'], 'commands-input')
                self.assertEqual(options['test_name'], 'testTrustedCommands')
                self.assertEqual(options['fixture_binding'], binding)
                self.assertEqual(options['app_path'], raw / 'NAC Development Preview Smoke.app')
                if failure == 'actor': raise RuntimeError('inert actor refused')
                config = case / 'xctest-fixture.json'; config.write_text('inert fixed configuration')
                config_hash = hashlib.sha256(config.read_bytes()).hexdigest()
                driver['configuration_sha256'] = config_hash
                evidence = case / 'evidence'
                if failure == 'settlement': final['accepted'] = False
                for name, value in [('commands-input.json', record), ('commands-input-phase.json', final),
                                    ('commands-xctest-driver.json', driver)]:
                    (evidence / name).write_text(json.dumps(value))
                bounded(['xcodebuild', 'build-for-testing'], case / 'build.log', 180, env={'safe': 'only'})
                bounded(['xcodebuild', 'test-without-building'], case / 'test.log', 240, env={'safe': 'only'})
                options['validate'](record)
                (case / 'xctest-policy-comparison.json').write_text(json.dumps({
                    'persistent_authorization_policy_unchanged': failure != 'policy'}))
                return {'runner': {'fixture_sha256': config_hash}}
            with patch('ci_xctest.run_terminal', side_effect=launcher), \
                    patch('ci_commands.time.monotonic', side_effect=[1000, 1001, 1002, 1003, 1004]):
                if failure:
                    with self.assertRaises(RuntimeError): commands.qualify(raw, run, lambda args: '', binding['source'])
                else:
                    commands.qualify(raw, run, lambda args: '', binding['source'])
            return calls

    def test_actor_precedes_full_smoke_and_cannot_extend_original_phase_allowance(self):
        calls = self.exercise()
        self.assertEqual([args[0] for args, _, _ in calls], ['bash', 'xcodebuild', 'xcodebuild', 'python3'])
        self.assertEqual([timeout for _, timeout, _ in calls], [799, 180, 240, 796])
        self.assertEqual(calls[1][2], {'env': {'safe': 'only'}})

    def test_dirty_actor_policy_or_missing_aggregate_never_pass(self):
        for failure in ('dirty', 'actor', 'policy', 'settlement', 'aggregate', 'coverage'):
            with self.subTest(failure=failure): self.exercise(failure=failure)

    def test_original_phase_deadline_is_not_reset(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch('ci_commands.time.monotonic', side_effect=[1000, 1801]):
            with self.assertRaises(TimeoutError):
                commands.qualify(Path(directory), lambda *args: self.fail('Expired work dispatched'), lambda args: '', 'a' * 40)

    def test_source_routes_before_legacy_self_post_and_preserves_local_full_controls(self):
        root = Path(__file__).parent
        ci = (root / 'ci.py').read_text()
        self.assertIn("report['command_input'] = qualify_commands", ci)
        builder = (root / 'preview.sh').read_text()
        self.assertIn('smoke|smoke-prepare)', builder)
        self.assertIn("python3 -B -m unittest discover -s desktop/macos -p 'test_*.py'", builder)
        self.assertIn('if [[ "$mode" == smoke ]]; then\n            exec python3 -B desktop/macos/smoke.py', builder)
        actor = (root / 'NativeUITests/NativeJourneys.swift').read_text()
        producer = (root / 'NativeCommandInput.swift').read_text()
        for name in commands.PHASES:
            self.assertIn('"' + name + '"', actor)
            self.assertIn('"' + name + '"', producer)
        self.assertIn('"--commands-external"', actor)
        self.assertIn('try requireTarget(try XCTUnwrap(owner)', actor)
        self.assertIn('composers.firstMatch.typeText(String(character))', actor)
        self.assertNotIn('CGEvent(', actor)
        self.assertEqual(sum(isinstance(n, ast.FunctionDef) and n.name == 'qualify'
                             for n in ast.walk(ast.parse((root / 'ci_commands.py').read_text()))), 1)


if __name__ == '__main__':
    unittest.main()
