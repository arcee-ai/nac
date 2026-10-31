"""Admission regression tests; no XCTest execution or paint claim."""
import copy
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

from contract import (BASELINE, CASES, SCHEMA, FUTURE_RECOVERY_MESSAGE,
                      inspect_normal_package, require_console, require_future_recovery,
                      validate, validate_normal_package)

PRODUCT = 'd443a2aca506def2817b9afc0c9a20a75f5c4b5d'
HARNESS = 'a4ec6b17a92dabd28501fa427992528cd3729100'


def console_matrix():
    """H's existing UID123/root-false/Quartz fixture, plus malformed flags."""
    base = {'name': 'positive-omitted-quartz', 'uid': 123, 'root': {'IOConsoleLocked': False,
            'IOConsoleUsers': [{'kCGSSessionUserIDKey': 123, 'kCGSSessionOnConsoleKey': True,
                               'kCGSessionLoginDoneKey': True, 'CGSSessionScreenIsLocked': False}]},
            'quartz': {'quartz_session_available': True, 'on_console': True, 'login_done': True,
                       'screen_count': 1, 'screen_is_locked': None,
                       'frontmost_bundle': 'com.apple.AccessibilityUIServer'}}
    cases = [base]
    for side in ('session', 'quartz'):
        for label, value in [('omitted', None), ('false', False), ('true', True), ('zero', 0),
                             ('one', 1), ('string', 'false'), ('list', []), ('object', {})]:
            row = copy.deepcopy(base)
            row['name'] = side + '-' + label
            target = row['quartz'] if side == 'quartz' else row['root']['IOConsoleUsers'][0]
            key = 'screen_is_locked' if side == 'quartz' else 'CGSSessionScreenIsLocked'
            if value is None:
                target.pop(key, None)
            else:
                target[key] = value
            cases.append(row)
    for section, key, value in [
        ('root', 'IOConsoleLocked', None), ('root', 'IOConsoleLocked', True),
        ('root', 'IOConsoleLocked', 0), ('session', 'kCGSSessionUserIDKey', 456),
        ('session', 'kCGSSessionOnConsoleKey', False), ('session', 'kCGSessionLoginDoneKey', False),
        ('quartz', 'quartz_session_available', False), ('quartz', 'on_console', False),
        ('quartz', 'login_done', False), ('quartz', 'screen_count', 0),
        ('quartz', 'frontmost_bundle', None), ('quartz', 'frontmost_bundle', ''),
        ('quartz', 'frontmost_bundle', 'unavailable'), ('quartz', 'frontmost_bundle', 'com.apple.loginwindow')]:
        row = copy.deepcopy(base)
        row['name'] = section + '-' + key + '-' + str(value)
        target = row['root']['IOConsoleUsers'][0] if section == 'session' else row[section]
        if value is None:
            target.pop(key, None)
        else:
            target[key] = value
        cases.append(row)
    return cases


def policy_result(row):
    try:
        return {'passed': True, 'observation': require_console(row['root'], row['uid'], row['quartz'])}
    except ValueError:
        return {'passed': False}


class ConsoleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get('NAC342_SWIFT_POLICY_PROOF') != '1':
            return
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-console-policy-unit-')
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        policy = source.split('// BEGIN CONSOLE POLICY', 1)[1].split('\n', 1)[1].split('// END CONSOLE POLICY', 1)[0]
        driver = '''
let bytes = FileHandle.standardInput.readDataToEndOfFile()
let cases = try JSONSerialization.jsonObject(with: bytes) as! [[String: Any]]
let results: [[String: Any]] = cases.map { row in
    do {
        let observation = try StartupConsolePolicy.evaluate(root: row["root"] as! [String: Any],
            uid: (row["uid"] as! NSNumber).intValue, quartz: row["quartz"] as! [String: Any])
        return ["passed": true, "observation": observation]
    } catch { return ["passed": false] }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
'''
        file = Path(cls.temporary.name) / 'main.swift'
        file.write_text('import Foundation\nimport CoreFoundation\n' + policy + driver)
        cls.runner = Path(cls.temporary.name) / 'console-policy'
        subprocess.run(['swiftc', str(file), '-o', str(cls.runner)], check=True, capture_output=True)

    def test_same_matrix_against_immutable_H_policy(self):
        source = subprocess.check_output(['git', 'show', HARNESS + ':desktop/macos/ci_support.py'])
        namespace = {}
        exec(compile(source, 'immutable_H_ci_support.py', 'exec'), namespace)
        for row in console_matrix():
            with self.subTest(case=row['name']):
                try:
                    expected = {'passed': True, 'observation': namespace['require_console'](
                        plistlib.dumps(row['root']), row['uid'], row['quartz'])}
                except RuntimeError:
                    expected = {'passed': False}
                self.assertEqual(policy_result(row), expected)

    def test_absent_flags_remain_null_and_duplicate_UID_is_refused(self):
        row = console_matrix()[0]
        del row['root']['IOConsoleUsers'][0]['CGSSessionScreenIsLocked']
        result = policy_result(row)
        self.assertTrue(result['passed'])
        self.assertIsNone(result['observation']['session_lock_flag'])
        self.assertIsNone(result['observation']['quartz_lock_flag'])
        row['root']['IOConsoleUsers'].append(copy.deepcopy(row['root']['IOConsoleUsers'][0]))
        self.assertFalse(policy_result(row)['passed'])

    @unittest.skipUnless(os.environ.get('NAC342_SWIFT_POLICY_PROOF') == '1', 'Foundation-only Swift source proof not requested')
    def test_same_matrix_against_compiled_exact_Swift_policy(self):
        cases = console_matrix()
        result = subprocess.run([str(self.runner)], input=json.dumps(cases).encode(),
                                capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), [policy_result(row) for row in cases])


@unittest.skipUnless(os.environ.get('NAC342_SWIFT_PATH_PROOF') == '1', 'Foundation/Darwin path proof not requested')
class PathTests(unittest.TestCase):
    """Compile the actual policy; fixtures contain inert files, never app code."""
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-path-policy-unit-')
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        policy = source.split('// BEGIN PATH POLICY', 1)[1].split('\n', 1)[1].split('// END PATH POLICY', 1)[0]
        driver = '''
let rows = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
let results: [[String: Any]] = rows.map { row in
    do {
        if let lexical = row["lexical"] as? String {
            return ["passed": StartupPaths.lexical(lexical)]
        }
        let paths = try StartupPaths(root: row["root"] as! String, app: row["app"] as! String)
        if let replace = row["replace"] as? String {
            let target = replace == "root" ? paths.root.path : replace == "app" ? paths.app.path : paths.native.path
            try FileManager.default.moveItem(atPath: target, toPath: target + ".retained")
            if replace != "native" {
                try FileManager.default.createDirectory(atPath: paths.app.path + "/Contents/MacOS",
                    withIntermediateDirectories: true)
            }
            try Data("inert native fixture".utf8).write(to: URL(fileURLWithPath: paths.native.path))
        }
        let bundle = URL(fileURLWithPath: row["bundle"] as! String)
        let executable = URL(fileURLWithPath: row["executable"] as! String)
        let resolved = row["resolve_observations"] as? Bool == true
        try StartupPaths.need(paths.matches(bundle: resolved ? bundle.resolvingSymlinksInPath() : bundle,
            executable: resolved ? executable.resolvingSymlinksInPath() : executable), "Resource witness differs")
        try StartupPaths.need(!StartupPaths.observes(URL(string: "https://example.invalid/NAC.app"), resource: paths.app),
            "Non-file URL accepted")
        try StartupPaths.need(paths.profiles(home: row["home"] as! String, nac: row["nac"] as! String,
            workspace: row["workspace"] as! String, store: row["store"] as! String), "Profile declaration escaped")
        return ["passed": true, "emitted_path": paths.emittedPath, "launch_path": paths.url.path,
            "observed_bundle": (resolved ? bundle.resolvingSymlinksInPath() : bundle).path,
            "physical_bundle": StartupPaths.physical(bundle.path) as Any? ?? NSNull()]
    } catch { return ["passed": false, "reason": error.localizedDescription] }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]))
'''
        file = Path(cls.temporary.name) / 'main.swift'
        file.write_text('import Foundation\nimport Darwin\n' + policy + driver)
        cls.runner = Path(cls.temporary.name) / 'path-policy'
        subprocess.run(['swiftc', '-swift-version', '5', str(file), '-o', str(cls.runner)], check=True, capture_output=True)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='nac342-owned-paths-')
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name).resolve()

    def fixture(self, name):
        root = self.base / ('nac342-xctest-' + name)
        app = root / 'Moved app folder with spaces/NAC.app'
        native = app / 'Contents/MacOS/NACPreview'
        native.parent.mkdir(parents=True)
        native.write_bytes(b'inert native fixture')
        home = root / 'missing home with spaces'
        return dict(root=str(root), app=str(app), bundle=str(app), executable=str(native),
                    home=str(home), nac=str(home / 'selected nac'), workspace=str(root / 'missing workspace'),
                    store=str(home / 'selected nac/dev.db'))

    def run_rows(self, rows):
        result = subprocess.run([str(self.runner)], input=json.dumps(rows).encode(), check=True, capture_output=True)
        return json.loads(result.stdout)

    def test_physical_declarations_and_verified_platform_alias_observations(self):
        row = self.fixture('physical')
        self.assertTrue(row['root'].startswith('/private/var/'), 'This proof requires the actual macOS temp alias')
        self.assertTrue(os.path.samefile('/private/var', '/var'))
        alias = {**row, 'bundle': row['bundle'].replace('/private/var/', '/var/', 1),
                 'executable': row['executable'].replace('/private/var/', '/var/', 1)}
        for result in self.run_rows([row, {**row, 'resolve_observations': True}, alias]):
            self.assertTrue(result['passed'], result)
            self.assertEqual(result['emitted_path'], row['app'])
            self.assertEqual(result['launch_path'], row['app'])
            self.assertEqual(result['physical_bundle'], row['app'])
        # Verified aliases are observations, never accepted declaration spellings.
        declared_alias = {key: value.replace('/private/var/', '/var/', 1) for key, value in row.items()}
        self.assertFalse(self.run_rows([declared_alias])[0]['passed'])

    def test_bounded_absolute_lexical_paths(self):
        bad = ['', '/', 'relative', '/a/', '//a', '/a//b', '/a/./b', '/a/../b',
               '/a\0b', '/a\nb', '/a\tb', '/a\x7fb', '/a\u0085b', '/' + 'x' * 4096]
        results = self.run_rows([{'lexical': value} for value in bad] + [{'lexical': '/a space/b'}])
        self.assertEqual([row['passed'] for row in results], [False] * len(bad) + [True])

    def test_exact_owned_layout_and_foreign_resource_witnesses(self):
        row, foreign = self.fixture('owned'), self.fixture('foreign')
        sibling = self.fixture('owned-sibling')
        rows = [{**row, 'root': str(self.base / 'unowned')}, {**row, 'app': sibling['app']},
                {**row, 'app': foreign['app']}, {**row, 'app': row['app'].replace('NAC.app', 'NAC Preview.app')},
                {**row, 'app': row['root'] + '/nested/Moved app folder with spaces/NAC.app'},
                {**row, 'bundle': foreign['bundle']}, {**row, 'executable': foreign['executable']}]
        self.assertEqual([x['passed'] for x in self.run_rows(rows)], [False] * len(rows))

    def test_root_interior_final_and_native_symlink_declarations(self):
        rows = []
        for member in ('root', 'interior', 'app', 'native'):
            row = self.fixture('symlink-' + member)
            target = Path(row['root'] if member == 'root' else row['app'] if member == 'app'
                          else row['executable'] if member == 'native' else str(Path(row['app']).parent))
            retained = target.with_name(target.name + '.retained')
            target.rename(retained)
            target.symlink_to(retained, target_is_directory=member != 'native')
            rows.append(row)
        self.assertEqual([x['passed'] for x in self.run_rows(rows)], [False] * len(rows))

    def test_missing_and_wrong_type_root_app_and_native(self):
        rows = []
        for member in ('root', 'app', 'executable'):
            for wrong_type in (False, True):
                row = self.fixture(member + str(wrong_type))
                target = Path(row[member])
                if target.is_dir():
                    shutil.rmtree(target)
                    if wrong_type:
                        target.write_bytes(b'wrong type')
                else:
                    target.unlink()
                    if wrong_type:
                        target.mkdir()
                rows.append(row)
        self.assertEqual([x['passed'] for x in self.run_rows(rows)], [False] * len(rows))

    def test_same_path_replacement_cannot_reuse_pinned_resource_identity(self):
        rows = [{**self.fixture('replaced-' + member), 'replace': member} for member in ('root', 'app', 'native')]
        self.assertEqual([x['passed'] for x in self.run_rows(rows)], [False] * len(rows))

    def test_profile_declarations_are_component_contained_without_profile_io(self):
        row = self.fixture('profile')
        self.assertFalse(Path(row['home']).exists())
        self.assertTrue(self.run_rows([row])[0]['passed'])  # Missing profile/store leaves are allowed.
        rows = []
        for field in ('home', 'nac', 'workspace', 'store'):
            for value in ('relative', '/foreign', row[field] + '/../escape', row[field] + '//child', row[field] + '\n'):
                rows.append({**row, field: value})
        rows += [{**row, 'home': row['root'] + '-sibling/home'},
                 {**row, 'nac': row['home'] + '-sibling/nac'},
                 {**row, 'store': row['nac'] + '-sibling/dev.db'}]
        self.assertEqual([x['passed'] for x in self.run_rows(rows)], [False] * len(rows))
        self.assertFalse(Path(row['home']).exists())


@unittest.skipUnless(os.environ.get('NAC342_SWIFT_QUERY_PROOF') == '1', 'Pure Swift query projection proof not requested')
class QueryDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-query-projection-')
        cls.addClassCleanup(cls.temporary.cleanup)
        source = Path(__file__).with_name('StartupJourneys.swift').read_text()
        blocks = [source.split('// BEGIN ' + key, 1)[1].split('\n', 1)[1].split('// END ' + key, 1)[0]
                  for key in ('CONSOLE POLICY', 'PATH POLICY', 'QUERY DIAGNOSTIC')]
        driver = '''
let rows = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
let result: [[String: Any]] = rows.map { row in
    if row["action"] as? String == "assert" {
        var waits = 0, diagnostics = 0
        do {
            try StartupQueryDiagnostic.requireOnboarding(wait: {
                waits += 1; return StartupConsolePolicy.boolean(row["legacy"]) == true
            }, diagnose: { diagnostics += 1; _ = row["alternate_positive"] })
            return ["passed": true, "waits": waits, "diagnostics": diagnostics]
        } catch {
            let error = error as NSError
            return ["passed": false, "waits": waits, "diagnostics": diagnostics,
                    "domain": error.domain, "code": error.code, "message": error.localizedDescription]
        }
    }
    if row["action"] as? String == "candidate" {
        guard let candidate = StartupQueryDiagnostic.candidate(row["input"] as! [String: Any], target: 0)
            else { return ["accepted": false] }
        return ["accepted": true, "fields": candidate.fields, "bounded": candidate.bounded]
    }
    var census = StartupQueryDiagnostic.Census(start: 0)
    if row["action"] as? String == "slow_attribute" {
        var clock = 0.0, calls = 0
        _ = census.readCandidate()
        let first = StartupQueryDiagnostic.read(&census, now: clock) { () -> Int in
            calls += 1; clock = 5; return 1
        }
        let second = StartupQueryDiagnostic.read(&census, now: clock) { () -> Int in
            calls += 1; return 2
        }
        return ["first": first != nil, "second": second != nil, "calls": calls, "reads": census.reads]
    }
    if row["action"] as? String == "read_budget" {
        var attempts = 0
        for _ in 0..<12 {
            if census.readCandidate() { attempts += 1 }
        }
        return ["reads": census.reads, "attempts": attempts]
    }
    for item in row["rows"] as! [[String: Any]] {
        var candidates: [StartupQueryDiagnostic.Candidate] = []
        for input in item["candidates"] as? [[String: Any]] ?? [] {
            guard census.readCandidate() else { return ["accepted": false] }
            guard let candidate = StartupQueryDiagnostic.candidate(input, target: 0) else { return ["accepted": false] }
            candidates.append(candidate)
        }
        guard census.append(count: item["count"] as Any, candidates: candidates,
                            truncated: item["truncated"] as? Bool ?? false) else { return ["accepted": false] }
    }
    for time in row["times"] as? [Double] ?? [0.012] { _ = census.available(now: time) }
    if let special = row["clock"] as? String {
        _ = census.available(now: special == "nan" ? .nan : .infinity)
        _ = census.available(now: 7)
    }
    var binding = row["binding"] as! [String: Any]
    if row["epoch_nan"] as? Bool == true { binding["app_launch_epoch"] = Double.nan }
    guard let record = census.record(binding: binding, scenario: row["scenario"] as? String ?? "onboarding",
        guardBefore: row["guard_before"] as? Bool ?? true, guardAfter: row["guard_after"] as? Bool ?? true),
        StartupQueryDiagnostic.encode(record) != nil else { return ["accepted": false] }
    return ["accepted": true, "record": record]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
'''
        path = Path(cls.temporary.name) / 'main.swift'
        path.write_text('import Foundation\nimport CoreFoundation\nimport Darwin\n' + '\n'.join(blocks) + driver)
        cls.runner = path.with_name('query-proof')
        build = subprocess.run(['swiftc', '-swift-version', '5', str(path), '-o', str(cls.runner)], capture_output=True)
        if build.returncode:
            raise RuntimeError(build.stderr.decode())

    def run_rows(self, rows):
        result = subprocess.run([str(self.runner)], input=json.dumps(rows).encode(), check=True, capture_output=True)
        return json.loads(result.stdout)

    def candidate(self, **changes):
        return {**dict(element_type=48, exists=True, hittable=True, enabled=True, window_intersection=True,
                       label='No projects yet', value=None, identifier=''), **changes}

    def sample(self, **changes):
        config, _ = fixture()
        binding = {key: config[key] for key in ('source_sha', 'startup_source_sha256', 'app_path', 'native_sha256')}
        binding.update(test_source_sha=BASELINE, harness_sha=HARNESS, configuration_sha256='a' * 64,
                       app_pid=123, app_launch_epoch=1234567890.25, window_number=456)
        return {**dict(binding=binding, rows=[dict(count=0) for _ in range(12)]), **changes}

    def test_legacy_result_cannot_be_overridden_by_diagnostics(self):
        rows = [dict(action='assert', legacy=value, alternate_positive=alternate)
                for value in (False, True) for alternate in (False, True)]
        results = self.run_rows(rows)
        for row, found in zip(rows, results):
            self.assertEqual(found['passed'], row['legacy'])
            self.assertEqual(found['waits'], 1)
            self.assertEqual(found['diagnostics'], int(not row['legacy']))
            if not row['legacy']:
                self.assertEqual((found['domain'], found['code'], found['message']),
                                 ('NAC342', 1, 'Shared onboarding absent'))

    def test_exact_contains_trim_and_nonstring_projection(self):
        rows = [self.candidate(), self.candidate(label=' No projects yet ', value='No projects yet'),
                self.candidate(label='No projects yet suffix', identifier='No projects yet'),
                self.candidate(label='No projects YET', value=False, exists=False, hittable=False,
                               enabled=False, window_intersection=False)]
        found = self.run_rows([dict(action='candidate', input=row) for row in rows])
        self.assertTrue(found[0]['fields']['label_exact'])
        self.assertFalse(found[1]['fields']['label_exact'])
        self.assertTrue(found[1]['fields']['label_trim_exact'])
        self.assertTrue(found[1]['fields']['value_exact'])
        self.assertTrue(found[2]['fields']['label_contains'])
        self.assertTrue(found[2]['fields']['identifier_exact'])
        self.assertFalse(found[3]['fields']['value_is_string'])
        self.assertFalse(found[3]['fields']['label_exact'])
        self.assertFalse(found[3]['fields']['hittable'])

    def test_malformed_candidate_and_private_text_never_escape(self):
        bad = [self.candidate(element_type=True), self.candidate(element_type=1.0), self.candidate(element_type=1.5),
               self.candidate(element_type=1001), self.candidate(exists=1), self.candidate(label=None),
               self.candidate(raw_tree='secret/private/path')]
        self.assertEqual([r['accepted'] for r in self.run_rows([dict(action='candidate', input=x) for x in bad])],
                         [False] * len(bad))
        found = self.run_rows([dict(action='candidate', input=self.candidate(label='SECRET/PATH/' * 40))])[0]
        self.assertFalse(found['bounded'])
        self.assertNotIn('SECRET', json.dumps(found))
        self.assertNotIn('label', found['fields'])

    def test_prefix_order_and_fifth_query_candidate_boundary(self):
        good, bad = self.sample(), self.sample()
        for row, index in [(good, 4), (bad, 3)]:
            row['rows'][index] = dict(count=1, candidates=[self.candidate()])
        results = self.run_rows([good, bad])
        self.assertTrue(results[0]['accepted'])
        self.assertEqual(results[0]['record']['queries'][4]['query'], 'window_static_title')
        self.assertEqual(results[0]['record']['legacy_exists'], False)
        self.assertFalse(results[1]['accepted'])
        self.assertEqual(len({r['query'] for r in results[0]['record']['queries']}), 12)
        duplicate = self.sample()
        duplicate['rows'][4] = dict(count=2, candidates=[self.candidate(element_type=1)] * 2)
        record = self.run_rows([duplicate])[0]['record']
        self.assertEqual(record['queries'][4]['count'], 2)
        self.assertEqual([c['element_type'] for c in record['queries'][4]['candidates']], [1, 1])
        self.assertFalse(record['legacy_exists'])

    def test_query_count_candidate_and_projection_caps(self):
        self.assertEqual(self.run_rows([dict(action='slow_attribute')])[0],
                         dict(first=True, second=False, calls=1, reads=1))
        self.assertEqual(self.run_rows([dict(action='read_budget')])[0], dict(reads=8, attempts=8))
        bad = [self.sample(rows=[dict(count=-1)]), self.sample(rows=[dict(count=True)]),
               self.sample(rows=[dict(count=1.0)]), self.sample(rows=[dict(count=1.5)]), self.sample(rows=[dict(count=0)] * 13)]
        per_row = self.sample(); per_row['rows'][4] = dict(count=5, candidates=[self.candidate()] * 5)
        total = self.sample()
        for index in (4, 5, 6): total['rows'][index] = dict(count=3, candidates=[self.candidate()] * 3)
        missing = self.sample(); missing['rows'][4] = dict(count=1)
        self.assertEqual([r['accepted'] for r in self.run_rows(bad + [per_row, total, missing])], [False] * 8)
        overflow = self.run_rows([self.sample(rows=[dict(count=4097)])])[0]['record']
        self.assertEqual((overflow['stop_reason'], overflow['queries'][0]['count']), ('count_limit', 4096))
        cut = self.sample(); cut['rows'][4] = dict(count=1, candidates=[self.candidate(label='X' * 257)])
        record = self.run_rows([cut])[0]['record']
        self.assertEqual((record['status'], record['stop_reason']), ('partial', 'candidate_limit'))

    def test_final_time_edges_and_sticky_invalid_clock(self):
        times = [4.999, 5, 5.001, 600, 600.001]
        found = self.run_rows([self.sample(times=[time]) for time in times])
        self.assertEqual([r['record']['elapsed_ms'] for r in found], [4999, 5000, 5001, 600000, 600000])
        self.assertEqual([r['record']['status'] for r in found], ['complete'] + ['partial'] * 4)
        self.assertEqual([r['record']['elapsed_overflow'] for r in found], [False] * 4 + [True])
        for item in self.run_rows([self.sample(times=[2, 1, 7]), self.sample(times=[-1, 7]),
                                  self.sample(clock='nan'), self.sample(clock='inf')]):
            record = item['record']
            self.assertEqual((record['stop_reason'], record['elapsed_ms'], record['elapsed_overflow']),
                             ('clock_invalid', 0, False))
        record = self.run_rows([self.sample(rows=[dict(count=4097)], times=[5])])[0]['record']
        self.assertEqual(record['stop_reason'], 'time_budget')

    def test_binding_guard_and_serialization_admission(self):
        rows = [self.sample(guard_before=False), self.sample(guard_after=False), self.sample(epoch_nan=True),
                self.sample(scenario='futureStore')]
        for key, value in [('app_pid', True), ('app_launch_epoch', True), ('window_number', 0), ('source_sha', 'BAD'),
                           ('configuration_sha256', 'x' * 64), ('app_path', '../foreign'), ('raw', 'SECRET')]:
            row = self.sample(); row['binding'][key] = value; rows.append(row)
        self.assertEqual([r['accepted'] for r in self.run_rows(rows)], [False] * len(rows))
        row = self.sample()
        for index in (4, 5): row['rows'][index] = dict(count=4, candidates=[self.candidate()] * 4)
        row['binding']['app_path'] = '/'+ 'x' * 4000 + '/Moved app folder with spaces/NAC.app'
        self.assertFalse(self.run_rows([row])[0]['accepted'])


def fixture():
    root = '/private/tmp/nac342-xctest-owned'
    home = root + '/home with spaces'
    config = dict(schema=SCHEMA, contract_baseline=BASELINE, scenario='onboarding',
                  source_sha=BASELINE, startup_source_sha256='1' * 64,
                  native_sha256='2' * 64, engine_sha256='3' * 64,
                  info_plist_sha256='4' * 64, build_receipt_sha256='5' * 64,
                  bundle_id='ai.arcee.nac.local-development', fixture_root=root,
                  app_path=root + '/Moved app folder with spaces/NAC.app', home=home,
                  nac_home=home + '/selected nac', workspace=root + '/workspace with spaces',
                  expected_store=home + '/selected nac/dev.db', environment={
                      'HOME': home, 'NAC_HOME': home + '/selected nac',
                      'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
                      'NAC_TELEMETRY': 'disabled', 'NAC_ORCHESTRATION': '0',
                      'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                      'BROWSER': 'none', 'MODELS_DEV_URL': 'http://127.0.0.1:12345/models-dev'})
    receipt = dict(source_head=BASELINE, source_dirty=False, mode='app-build',
                   engine_identity={'source_revision': BASELINE}, normal_startup=True,
                   preview_definitions_excluded=True, smoke_instrumentation=False,
                   compiler_flags=['-swift-version', '5', '-D', 'LOCAL_APP'],
                   **{key: config[key] for key in ('native_sha256', 'engine_sha256', 'info_plist_sha256')})
    return config, receipt


class AdmissionTests(unittest.TestCase):
    def test_nominated_serving_failure_and_exact_guidance(self):
        # Synthetic observation only, not a producer implementation claim.
        failure = {'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible', 'stage': 'startup'}
        require_future_recovery(failure, FUTURE_RECOVERY_MESSAGE)
        for key, value in [('code', 'startup_failed'), ('stage', '__desktop-configuration'),
                           ('kind', 'ready'), ('version', True), ('version', 2)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                require_future_recovery({**failure, key: value}, FUTURE_RECOVERY_MESSAGE)

    def test_old_source_generic_failure_or_footer_cannot_pass(self):
        generic = ('A store written by a newer NAC version requires a compatible version; '
                   'keep the existing database. Check directory access and whether another NAC process owns this store.')
        nominated = {'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible', 'stage': 'startup'}
        for message in (generic, 'NAC could not continue', FUTURE_RECOVERY_MESSAGE.lower(),
                        FUTURE_RECOVERY_MESSAGE[:-1], FUTURE_RECOVERY_MESSAGE + ' '):
            with self.subTest(message=message), self.assertRaises(ValueError):
                require_future_recovery(nominated, message)
        # A unique message alone also cannot disguise an old typed producer.
        with self.assertRaises(ValueError):
            require_future_recovery({**nominated, 'code': 'startup_failed'}, FUTURE_RECOVERY_MESSAGE)

    def test_four_exact_states_are_declarations_only(self):
        config, receipt = fixture()
        for case in CASES:
            config['scenario'] = case
            result = validate(config, receipt)
            self.assertEqual(result, {'scope': 'declaration_admission_only', 'scenario': case,
                                      'actual_ui_run': False, 'paint_qualified': False})

    def test_instrumented_or_dirty_receipts_are_refused(self):
        for key, value in [('source_dirty', True), ('source_dirty', 0),
                           ('smoke_instrumentation', True), ('normal_startup', False),
                           ('preview_definitions_excluded', False), ('mode', 'startup-build'),
                           ('instance_smoke_instrumentation', True),
                           ('compiler_flags', ['-D', 'LOCAL_APP', '-D', 'PREVIEW_SMOKE']),
                           ('compiler_flags', ['-D', 'LOCAL_APP', '-D']),
                           ('native_sha256', 'f' * 64), ('bundle_identifier', 'ai.arcee.nac')]:
            with self.subTest(key=key, value=value):
                config, receipt = fixture()
                receipt[key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_wrong_source_and_engine_are_refused(self):
        config, receipt = fixture()
        for section in ('source_head', 'engine_identity'):
            wrong = copy.deepcopy(receipt)
            wrong[section] = 'f' * 40 if section == 'source_head' else {'source_revision': 'f' * 40}
            with self.assertRaises(ValueError):
                validate(config, wrong)

    def test_profile_escape_and_preview_app_are_refused(self):
        for key, value in [('home', '/Users/personal'), ('nac_home', '/Users/personal/.config/nac'),
                           ('expected_store', '/private/tmp/alternate.db'),
                           ('workspace', '/private/tmp/nac342-xctest-owned/../personal'),
                           ('app_path', '/private/tmp/nac342-xctest-owned/Moved app folder with spaces/NAC Startup Smoke.app'),
                           ('fixture_root', '/private/tmp/unowned')]:
            with self.subTest(key=key):
                config, receipt = fixture()
                config[key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_real_credential_managed_or_remote_catalog_are_refused(self):
        for key, value in [('ARCEE_API_KEY', 'do-not-use'), ('NAC_MANAGED_CONFIG', ''),
                           ('MODELS_DEV_URL', 'https://models.example.test/models-dev'),
                           ('MODELS_DEV_URL', 'http://user:password@127.0.0.1:123/models-dev'),
                           ('MODELS_DEV_URL', 'http://127.0.0.1:123/models-dev?key=no'),
                           ('HOME', '/Users/personal'), ('NAC_ORCHESTRATION', 'true')]:
            with self.subTest(key=key, value=value):
                config, receipt = fixture()
                config['environment'][key] = value
                with self.assertRaises(ValueError):
                    validate(config, receipt)

    def test_unknown_state_or_unbound_source_is_refused(self):
        for key, value in [('scenario', 'genericError'), ('source_sha', 'HEAD'),
                           ('contract_baseline', 'f' * 40), ('startup_source_sha256', '')]:
            config, receipt = fixture()
            config[key] = value
            with self.assertRaises(ValueError):
                validate(config, receipt)


@unittest.skipUnless(os.environ.get('NAC342_PRODUCT_SOURCE_ROOT'), 'Exact separate P checkout is required')
class NormalPackageTests(unittest.TestCase):
    """Tiny synthetic artifacts, real nominated P owner; never executable code."""
    @classmethod
    def setUpClass(cls):
        cls.product = Path(os.environ['NAC342_PRODUCT_SOURCE_ROOT']).resolve()
        script = '''
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'desktop/macos/packaging'))
from provenance import clean_source,digest
from native_receipt import NORMAL_SOURCES,BUILD_SUPPORT,NORMAL_FLAGS,FIXTURE_MARKERS
print(json.dumps({'source':clean_source(root),'flags':NORMAL_FLAGS,
 'markers':FIXTURE_MARKERS,
 'native':{name:digest(root/name) for name in NORMAL_SOURCES},
 'support':{name:digest(root/name) for name in BUILD_SUPPORT}}))
'''
        cls.description = json.loads(subprocess.check_output([sys.executable, '-B', '-c', script, str(cls.product)]))
        if cls.description['source']['revision'] != PRODUCT:
            raise ValueError('Tests require the nominated clean P')

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nac342-package-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.original = self.base / 'producer/NAC.app'
        self.root = self.base / 'nac342-xctest-case'
        self.relocated = self.root / 'Moved app folder with spaces/NAC.app'
        self.manifest_path = self.original.parent / 'manifest.json'
        self.identity = {'product_version': self.description['source']['product_version'],
                         'source_revision': PRODUCT, 'track': 'dev', 'build_id': 'dev-' + PRODUCT}
        self.receipt = dict(version=1, phase='unsigned-build', source_head=PRODUCT, source_dirty=False,
            mode='app-build', normal_startup=True, smoke_instrumentation=False, instance_smoke_instrumentation=False,
            preview_definitions_excluded=True, compiler_flags=self.description['flags'],
            fixture_markers_absent=self.description['markers'], sdk_version='synthetic-unit-not-SDK-qualification',
            native_source_files=copy.deepcopy(self.description['native']), build_support_files=self.description['support'],
            bundle_identifier='ai.arcee.nac.dev', bundle_name='NAC Development', engine_identity=self.identity,
            native_sha256='1' * 64, engine_sha256='2' * 64, info_plist_sha256='3' * 64)
        self.marker = {'schema_version': 1, 'purpose': 'normal-app-preparation', 'consumer_distribution': False,
            'source': copy.deepcopy(self.description['source']), 'build': {'track': 'dev', 'id': 'dev-' + PRODUCT},
            'engine_identity': copy.deepcopy(self.identity), 'native_build_receipt': copy.deepcopy(self.receipt),
            'engine_input': {'sha256': self.receipt['engine_sha256'], 'size': 5}}
        self.seal()

    def seal(self):
        app = self.original
        (app / 'Contents/Resources').mkdir(parents=True, exist_ok=True)
        (app / 'Contents/MacOS').mkdir(parents=True, exist_ok=True)
        (app / 'Contents/MacOS/NACPreview').write_bytes(b'synthetic signed native; never execute')
        (app / 'Contents/Resources/nac-web').write_bytes(b'synthetic signed engine; never execute')
        for name, data in [('PackageIdentity.json', self.marker), ('build-receipt.json', self.receipt),
                           ('engine-identity.json', self.identity)]:
            (app / 'Contents/Resources' / name).write_text(json.dumps(data))
        info = {'CFBundleIdentifier': 'ai.arcee.nac.dev', 'CFBundleName': 'NAC Development',
                'CFBundleShortVersionString': self.identity['product_version'], 'CFBundleVersion': self.identity['product_version']}
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        files = {str(file.relative_to(app)): {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                 'size': file.stat().st_size, 'mode': file.stat().st_mode & 0o7777}
                 for file in app.rglob('*') if file.is_file()}
        signatures = {key: {'kind': 'ad-hoc', 'hardened_runtime': True, 'entitlements': {}}
                      for key in ('app', 'engine')}
        post = {'schema_version': 1, 'phase': 'ad-hoc-preparation', 'source_revision': PRODUCT,
            'engine_identity': self.identity, 'bundle_identifier': info['CFBundleIdentifier'],
            'bundle_name': info['CFBundleName'], 'product_version': self.identity['product_version'],
            'bundle_version': self.identity['product_version'], 'signatures': signatures, 'qualified_consumer': False,
            **{key: files[name]['sha256'] for key, name in [('native_sha256', 'Contents/MacOS/NACPreview'),
                ('engine_sha256', 'Contents/Resources/nac-web'), ('info_plist_sha256', 'Contents/Info.plist')]}}
        archive = self.original.parent / 'synthetic.zip'
        archive.write_bytes(b'synthetic container; not a distributable archive')
        self.manifest = {'schema_version': 1, 'identity': self.marker,
            'bundle': {'name': 'NAC.app', 'identifier': info['CFBundleIdentifier'], 'files': files,
                       'sha256': hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()},
            'container': {'name': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'size': archive.stat().st_size},
            'post_sign_receipt': post, 'signatures': signatures, 'qualification': {'actual_app_runtime': False}}
        self.write_manifest()
        if self.relocated.exists():
            shutil.rmtree(self.relocated)
        shutil.copytree(app, self.relocated)

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest))

    def config(self):
        config, _ = fixture()
        home = str(self.root / 'home with spaces')
        config.update(source_sha=PRODUCT, test_source_sha=BASELINE, harness_sha=HARNESS,
            fixture_root=str(self.root), app_path=str(self.relocated), home=home,
            nac_home=home + '/selected nac', workspace=str(self.root / 'workspace with spaces'),
            expected_store=home + '/selected nac/dev.db', bundle_id='ai.arcee.nac.dev',
            engine_identity=self.identity, manifest_sha256=hashlib.sha256(self.manifest_path.read_bytes()).hexdigest())
        config['environment'].update(HOME=home, NAC_HOME=home + '/selected nac')
        for key, name in [('native_sha256', 'Contents/MacOS/NACPreview'), ('engine_sha256', 'Contents/Resources/nac-web'),
                          ('info_plist_sha256', 'Contents/Info.plist'), ('build_receipt_sha256', 'Contents/Resources/build-receipt.json'),
                          ('package_identity_sha256', 'Contents/Resources/PackageIdentity.json'),
                          ('engine_identity_sha256', 'Contents/Resources/engine-identity.json')]:
            config[key] = hashlib.sha256((self.relocated / name).read_bytes()).hexdigest()
        return config

    def admit(self, config=None):
        return validate_normal_package(config or self.config(), self.manifest_path, self.product,
            product_sha=PRODUCT, test_sha=BASELINE, harness_sha=HARNESS)

    def test_final_hashes_admit_without_rewriting_unsigned_receipt(self):
        before = (self.relocated / 'Contents/Resources/build-receipt.json').read_bytes()
        result = self.admit()
        self.assertEqual(result['scope'], 'normal_package_admission_only')
        self.assertFalse(result['actual_ui_run'])
        self.assertEqual(before, (self.relocated / 'Contents/Resources/build-receipt.json').read_bytes())
        with self.assertRaises(ValueError):
            validate(self.config(), self.receipt)
        wrong = self.config()
        wrong.update({key: self.receipt[key] for key in ('native_sha256', 'engine_sha256', 'info_plist_sha256')})
        with self.assertRaises(ValueError):
            self.admit(wrong)

    def test_missing_or_wrong_post_sign_phase_is_refused(self):
        for phase in (None, 'unsigned-build'):
            self.manifest['post_sign_receipt'].pop('phase', None)
            if phase:
                self.manifest['post_sign_receipt']['phase'] = phase
            self.write_manifest()
            with self.assertRaises(ValueError):
                self.admit()

    def test_foreign_embedded_receipt_cannot_be_resealed_into_provenance(self):
        self.receipt['source_head'] = 'f' * 40
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_consistent_foreign_source_is_refused(self):
        self.marker['source']['revision'] = 'f' * 40
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_source_roster_or_fixture_compiler_cannot_be_resealed(self):
        for field, value in [('native_source_files', {}), ('compiler_flags', ['-D', 'LOCAL_APP', '-D', 'PREVIEW_SMOKE']),
                             ('fixture_markers_absent', []), ('sdk_version', '')]:
            original = self.receipt[field]
            self.receipt[field] = value
            self.marker['native_build_receipt'] = copy.deepcopy(self.receipt)
            self.seal()
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.admit()
            self.receipt[field] = original

    def test_relocated_inventory_and_full_engine_identity_are_bound(self):
        (self.relocated / 'Contents/Resources/nac-web').write_bytes(b'foreign engine')
        with self.assertRaises(ValueError):
            self.admit()
        self.seal()
        self.identity['build_id'] = 'foreign-build'
        self.seal()
        with self.assertRaises(ValueError):
            self.admit()

    def test_manifest_marker_receipt_and_PQH_hashes_are_independent(self):
        for key in ('manifest_sha256', 'package_identity_sha256', 'engine_identity_sha256',
                    'build_receipt_sha256', 'test_source_sha', 'harness_sha'):
            config = self.config()
            config[key] = 'f' * len(config[key])
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.admit(config)


if __name__ == '__main__':
    unittest.main()
