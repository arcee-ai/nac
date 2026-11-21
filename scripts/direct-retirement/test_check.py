"""Tests of exact exceptions, baseline accounting and shipped-text scanning."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import check


class RetirementGuardTests(unittest.TestCase):
    def setUp(self):
        self.token = 'orche' + 'strator'
        self.data = {'version': 1, 'rules': [{'id': 'mode', 'pattern': self.token}], 'exceptions': []}

    def test_current_source_guide_and_package_output_each_fail(self):
        files = {'src/app.ts': self.token.encode(), 'docs/usage/setup.md': self.token.encode(),
                 'web/packages/client/dist/index.js': self.token.encode(),
                 '.github/workflows/check.yml': self.token.encode()}
        errors, _ = check.audit(files, self.data)
        self.assertEqual(len(errors), 4)
        for name in files:
            self.assertTrue(any(name in error for error in errors), name)

    def test_native_worker_is_unrelated_and_allowed(self):
        errors, _ = check.audit({'native/process.rs': b'worker processes are supervised'}, self.data)
        self.assertEqual(errors, [])

    def test_exact_legacy_fixture_passes_and_mutation_or_absence_fails(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v53-fresh.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=path, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Version-bounded predecessor fixture.')]
        self.assertEqual(check.audit({path: text}, self.data)[0], [])
        self.assertTrue(check.audit({path: text + b' -- changed'}, self.data)[0])
        self.assertTrue(check.audit({}, self.data)[0])

    def test_real_v53_fixture_is_an_explicit_hash_bound_exception(self):
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        path = 'crates/nac-core/src/store/schema/fixtures/v53-fresh.sql'
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        self.assertEqual(check.audit({path: (check.ROOT / path).read_bytes()}, manifest)[0], [])

    def test_legacy_resume_run_fixture_is_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v53-legacy-resume-run.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        self.assertEqual({entry['rule'] for entry in manifest['exceptions']},
                         {'retired_topology', 'retired_symbols', 'retired_surfaces', 'retired_presets'})
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        self.assertTrue(check.audit({}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v54-legacy-resume-run.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only the exact v53 predecessor fixture is allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_legacy_schedule_replay_fixture_is_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v53-legacy-schedule-replay.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        self.assertEqual({entry['rule'] for entry in manifest['exceptions']},
                         {'retired_topology', 'retired_symbols', 'retired_surfaces', 'retired_presets'})
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        self.assertTrue(check.audit({}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v54-legacy-schedule-replay.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only the exact v53 predecessor fixture is allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_v55_command_fixture_is_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v55-legacy-command-speed.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        self.assertTrue(check.audit({}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v56-legacy-command-speed.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only the exact v55 predecessor fixture is allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_admitted_frozen_fixture_is_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v53-admitted-frozen.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        self.assertEqual({entry['rule'] for entry in manifest['exceptions']},
                         {'retired_topology', 'retired_symbols', 'retired_surfaces', 'retired_presets'})
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        self.assertTrue(check.audit({}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v54-admitted-frozen.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only the exact v53 predecessor fixture is allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_source_task_fixture_is_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v55-source-task.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        self.assertTrue(check.audit({}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v56-source-task.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only the exact v55 predecessor fixture is allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_speed_predecessor_exceptions_are_exact_and_version_bounded(self):
        path = 'crates/nac-core/src/store/schema/fixtures/v56-speed-upgraded.sql'
        manifest = json.loads((check.ROOT / check.DIRECTORY / 'rules.json').read_text())
        manifest['exceptions'] = [entry for entry in manifest['exceptions'] if entry['path'] == path]
        raw = (check.ROOT / path).read_bytes()
        self.assertEqual(check.audit({path: raw}, manifest)[0], [])
        self.assertTrue(check.audit({path: raw + b'\n-- changed\n'}, manifest)[0])
        blocked = 'crates/nac-core/src/store/schema/fixtures/v57-speed-upgraded.sql'
        text = ('CREATE TABLE ' + self.token + ' (id INTEGER);').encode()
        self.data['exceptions'] = [dict(path=blocked, rule='mode', sha256=check.sha(text), count=1,
                                        reason='Only known predecessor writers are allowed.')]
        errors, _ = check.audit({blocked: text}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))

    def test_exact_line_exceptions_do_not_allow_new_or_stale_lines(self):
        line = 'legacy ' + self.token
        path = 'src/legacy_adapter.rs'
        entry = dict(kind='line', path=path, rule='mode', sha256=check.sha(line.encode()),
                     count=1, reason='Only this bounded historical decoder.')
        self.data['exceptions'] = [entry]
        self.assertEqual(check.audit({path: (line + '\ncurrent\n').encode()}, self.data)[0], [])
        self.assertTrue(check.audit({path: (line + '\nnew ' + self.token).encode()}, self.data)[0])
        self.assertTrue(check.audit({path: b'current'}, self.data)[0])
        self.data['exceptions'] = [entry, copy.deepcopy(entry)]
        self.assertTrue(any('duplicate' in e for e in check.audit({path: line.encode()}, self.data)[0]))

    def test_whole_source_file_exemption_is_rejected(self):
        path, raw = 'src/current.rs', self.token.encode()
        self.data['exceptions'] = [dict(path=path, rule='mode', sha256=check.sha(raw), count=1,
                                        reason='Not a permitted immutable fixture.')]
        errors, _ = check.audit({path: raw}, self.data)
        self.assertTrue(any('whole-file exception forbidden' in error for error in errors))
        self.assertTrue(any('unclassified' in error for error in errors))

    def test_baseline_roster_cannot_drop_paths_or_silently_mark_pending_done(self):
        roster = [{'path': 'a', 'disposition': 'neutralized'}, {'path': 'b', 'disposition': 'pending'}]
        data = {'revision': check.BASELINE_REVISION, 'paths': roster}
        digest = check.sha(b'a\nb\n')
        with patch.object(check, 'BASELINE_ROSTER_SHA256', digest):
            errors = check.baseline_problems(data, {'a', 'b'}, set(), set())
            self.assertTrue(any('pending' in error for error in errors))
            self.assertTrue(check.baseline_problems({'revision': check.BASELINE_REVISION, 'paths': roster[:1]},
                                                    {'a'}, set(), set()))
            roster[1]['disposition'] = 'neutralized'
            self.assertEqual(check.baseline_problems(data, {'a', 'b'}, set(), set()), [])
            self.assertTrue(check.baseline_problems(data, {'a', 'b'}, set(), {'b'}))

    def test_checked_in_baseline_roster_matches_bound_inventory(self):
        data = json.loads((check.ROOT / check.DIRECTORY / 'baseline-paths.json').read_text())
        names = [entry['path'] for entry in data['paths']]
        self.assertEqual(len(names), 482)
        self.assertEqual(check.sha(('\n'.join(names) + '\n').encode()), check.BASELINE_ROSTER_SHA256)


if __name__ == '__main__':
    unittest.main()
