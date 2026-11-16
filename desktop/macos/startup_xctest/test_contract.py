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
    def test_external_ax_declaration_is_closed_canonical_and_configured_only(self):
        config, receipt = fixture()
        config['scenario'] = 'configuredLocal'
        declaration = dict(path=config['fixture_root'] + '/ax-witness/receipt.json', nonce='a' * 64,
            helper_path='/private/owned-helper', helper_sha256='b' * 64, owner_pid=123, deadline_ns='1000000000',
            support_sha256={'StartupAXGuard.swift': 'c' * 64, 'StartupAXReceipt.swift': 'd' * 64})
        config['ax_witness'] = declaration
        self.assertFalse(validate(config, receipt)['actual_ui_run'])
        for change in [{'path': config['home'] + '/receipt.json'}, {'nonce': 'a' * 63}, {'owner_pid': True},
                       {'owner_pid': 2**31}, {'deadline_ns': '01'}, {'deadline_ns': '١'}, {'deadline_ns': '0'},
                       {'deadline_ns': str(2**64)}, {'support_sha256': None}, {'support_sha256': {}},
                       {'support_sha256': {'StartupAXGuard.swift': 'x' * 64, 'StartupAXReceipt.swift': 'd' * 64}},
                       {'extra': 'unowned'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate({**config, 'ax_witness': {**declaration, **change}}, receipt)
        with self.assertRaises(ValueError):
            validate({**config, 'scenario': 'onboarding'}, receipt)

    def test_future_recovery_matches_shipped_p9_sentence(self):
        shipped = ('The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible version of NAC. '
                   'Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.')
        typed = {'kind': 'failed', 'version': 1, 'code': 'store_schema_incompatible', 'stage': 'startup'}
        require_future_recovery(typed, shipped)
        self.assertEqual(FUTURE_RECOVERY_MESSAGE, shipped)
        obsolete = shipped.replace('compatible version of NAC', 'compatible newer NAC app')
        with self.assertRaises(ValueError):
            require_future_recovery(typed, obsolete)

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



@unittest.skipUnless(os.environ.get('NAC342_SWIFT_PANEL_PROOF') == '1',
                     'Compile-verbatim native-folder policy proof not requested')
class NativeFolderPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-panel-policy-')
        cls.addClassCleanup(cls.temporary.cleanup)
        root = Path(cls.temporary.name)
        source = Path(__file__).with_name('StartupAXGuard.swift').read_text()
        source = source.split('// BEGIN NATIVE FOLDER POLICY', 1)[1].split('// END NATIVE FOLDER POLICY', 1)[0]
        source = source[source.index('\n') + 1:]
        driver = r"""
func scalar(_ value: Any) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    return value as? String == "nan" ? .nan : .infinity
}
func rectangle(_ raw: Any) -> CGRect {
    if let sentinel = raw as? String {
        switch sentinel {
        case "CGRect.infinite": return .infinite
        case "CGRect.null": return .null
        case "CGRect.zero": return .zero
        default: preconditionFailure("Unknown rectangle sentinel")
        }
    }
    let a = raw as! [Any]
    return CGRect(x: scalar(a[0]), y: scalar(a[1]), width: scalar(a[2]), height: scalar(a[3]))
}
let rows = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [[String: Any]]
let results: [Any] = rows.map { row in
    switch row["mode"] as! String {
    case "surface":
        return StartupNativeFolderPolicy.surface(.init(rawValue: row["surface"] as! String)!,
            windows: row["windows"] as! Int, rootSheets: row["root"] as! Int,
            nestedSheets: row["nested"] as! Int, allSheets: row["all"] as! Int)
    case "attached":
        return StartupNativeFolderPolicy.attached(exists: row["exists"] as! Bool,
            frame: rectangle(row["frame"]!), owner: rectangle(row["owner"]!))
    case "usable":
        return StartupNativeFolderPolicy.usable(exists: row["exists"] as! Bool,
            enabled: row["enabled"] as! Bool, hittable: row["hittable"] as! Bool,
            frame: rectangle(row["frame"]!), owner: rectangle(row["owner"] ?? [0, 0, 500, 500]))
    case "binding":
        var binding = StartupNativeFolderPolicy.Binding<String>()
        return (row["steps"] as! [[String: Any]]).map { step in
            binding.accept(.init(rawValue: step["surface"] as! String)!, root: step["root"] as! String,
                panel: step["panel"] as? String, goTo: step["goTo"] as? String)
        }
    case "focus":
        return StartupNativeFolderPolicy.focused(pid: Int32(row["pid"] as! Int),
            expectedPID: 123, role: row["role"] as! String, focused: row["focused"] as! Bool,
            frame: rectangle(row["frame"]!), expectedFrame: CGRect(x: 10, y: 20, width: 100, height: 30),
            value: row["value"] as! String, expectedValue: "/owned/workspace with spaces")
    default:
        return StartupNativeFolderPolicy.selected(row["label"] as! String, workspace: "/owned/workspace with spaces")
    }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results))
"""
        swift = root / 'main.swift'
        swift.write_text('import Foundation\nimport CoreGraphics\n' + source + '\n' + driver)
        cls.binary = root / 'proof'
        result = subprocess.run(['swiftc', '-swift-version', '5', str(swift), '-o', str(cls.binary)],
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stderr)

    def run_rows(self, rows):
        result = subprocess.run([str(self.binary)], input=json.dumps(rows),
                                capture_output=True, text=True, timeout=10, check=True)
        return json.loads(result.stdout)

    def test_exact_owned_surface_shapes_reject_foreign_or_ambiguous_sheets(self):
        rows, expected = [], []
        for surface, counts in [('form', (0, 0, 0)), ('panel', (1, 0, 1)), ('goTo', (1, 1, 2))]:
            valid = dict(mode='surface', surface=surface, windows=1,
                         root=counts[0], nested=counts[1], all=counts[2])
            rows.append(valid); expected.append(True)
            for key in ('windows', 'root', 'nested', 'all'):
                for value in (-1, 0, 1, 2, 3):
                    if value != valid[key]:
                        rows.append({**valid, key: value}); expected.append(False)
        # A cancelled panel or Go to sheet cannot authorize the next input.
        rows += [dict(mode='surface', surface='panel', windows=1, root=0, nested=0, all=0),
                 dict(mode='surface', surface='goTo', windows=1, root=1, nested=0, all=1)]
        expected += [False, False]
        self.assertEqual(self.run_rows(rows), expected)

    def test_control_must_exist_be_enabled_hittable_and_have_positive_owned_geometry(self):
        valid = dict(mode='usable', exists=True, enabled=True, hittable=True,
                     frame=[10, 20, 100, 30])
        rows = [valid] + [{**valid, key: False} for key in ('exists', 'enabled', 'hittable')]
        rows += [{**valid, 'frame': frame} for frame in ([10, 20, 0, 30], [10, 20, -1, 30],
                 [10, 20, 100, -1], [1000, 1000, 10, 10], ['nan', 20, 10, 10])]
        self.assertEqual(self.run_rows(rows), [True] + [False] * (len(rows) - 1))

    def test_coregraphics_sentinels_rejected_for_control_and_panel_attachment(self):
        # Construct the native sentinel in Swift: finite components alone miss it.
        for mode in ('usable', 'attached'):
            valid = dict(mode=mode, exists=True, enabled=True, hittable=True,
                         frame=[10, 20, 100, 30], owner=[0, 0, 500, 500])
            rows = [valid, {**valid, 'frame': [499, 499, 1, 1]}]
            for key in ('frame', 'owner'):
                for frame in ('CGRect.infinite', 'CGRect.null', 'CGRect.zero',
                              [10, 20, 0, 30], [10, 20, -1, 30], [10, 20, 100, -1],
                              ['nan', 20, 100, 30], [10, 'infinity', 100, 30]):
                    rows.append({**valid, key: frame})
            rows += [{**valid, 'exists': False}, {**valid, 'frame': [500, 500, 1, 1]}]
            with self.subTest(mode=mode):
                self.assertEqual(self.run_rows(rows), [True, True] + [False] * (len(rows) - 2))
        # An attached panel may be obscured by its Go to Folder sub-sheet.
        hidden_parent = dict(exists=True, enabled=False, hittable=False,
                             frame=[10, 20, 100, 30], owner=[0, 0, 500, 500])
        self.assertEqual(self.run_rows([{**hidden_parent, 'mode': mode}
                                       for mode in ('attached', 'usable')]), [True, False])

    def sequence(self):
        return [dict(surface='form', root='root'),
                dict(surface='panel', root='root', panel='panel'),
                dict(surface='goTo', root='root', panel='panel', goTo='goTo'),
                dict(surface='panel', root='root', panel='panel'),
                dict(surface='form', root='root')]

    def test_same_incarnation_only_no_rebinding_after_cancel_or_replacement(self):
        valid = self.sequence()
        self.assertEqual(self.run_rows([dict(mode='binding', steps=valid)]), [[True] * 5])
        for index, key in [(1, 'root'), (2, 'panel'), (3, 'panel'), (4, 'root')]:
            steps = self.sequence(); steps[index][key] = 'replacement'
            got = self.run_rows([dict(mode='binding', steps=steps)])[0]
            self.assertFalse(got[index])
        steps = self.sequence() + [dict(surface='panel', root='root', panel='new-panel')]
        self.assertFalse(self.run_rows([dict(mode='binding', steps=steps)])[0][-1])
        steps = self.sequence()[:3] + [dict(surface='goTo', root='root', panel='panel', goTo='replacement')]
        self.assertFalse(self.run_rows([dict(mode='binding', steps=steps)])[0][-1])
        for steps in [[dict(surface='panel', root='root', panel='panel')],
                      [dict(surface='form', root='root', panel='foreign')],
                      [dict(surface='form', root='root'), dict(surface='goTo', root='root', panel='panel', goTo='goTo')]]:
            self.assertFalse(self.run_rows([dict(mode='binding', steps=steps)])[0][-1])

    def test_focus_requires_exact_pid_role_positive_focus_geometry_and_value(self):
        valid = dict(mode='focus', pid=123, role='AXTextField', focused=True,
                     frame=[10, 20, 100, 30], value='/owned/workspace with spaces')
        rows = [valid]
        for key, value in [('pid', 0), ('pid', 124), ('role', 'AXSecureTextField'),
                           ('focused', False), ('value', '/foreign/workspace with spaces'),
                           ('value', '/owned/workspace with spaces '),
                           ('frame', [11, 20, 100, 30]), ('frame', [10, 20, 0, 30]),
                           ('frame', ['nan', 20, 100, 30]), ('frame', [10, 'infinity', 100, 30])]:
            rows.append({**valid, key: value})
        self.assertEqual(self.run_rows(rows), [True] + [False] * (len(rows) - 1))

    def test_form_requires_full_declared_workspace_not_just_leaf_or_prefix(self):
        labels = ['Choose Working Folder: /owned/workspace with spaces',
                  'Choose Working Folder: /foreign/workspace with spaces',
                  'Choose Working Folder: /owned/workspace with spaces suffix',
                  'Choose Working Folder: /owned/workspace with spaces ',
                  'workspace with spaces', 'Choose Working Folder']
        self.assertEqual(self.run_rows([dict(mode='selection', label=x) for x in labels]),
                         [True, False, False, False, False, False])

@unittest.skipUnless(os.environ.get('NAC342_SWIFT_PANEL_PROOF') == '1',
                     'Compile-verbatim AX refusal controls not requested')
class AXRefusalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='nac342-ax-refusal-')
        cls.addClassCleanup(cls.temporary.cleanup)
        root = Path(cls.temporary.name)
        source = Path(__file__).with_name('StartupAXGuard.swift').read_text()
        def block(start, end):
            value = source.split(start, 1)[1].split(end, 1)[0]
            return value[value.index('\n') + 1:]
        policy = block('// BEGIN NATIVE FOLDER POLICY', '// END NATIVE FOLDER POLICY')
        diagnostic = block('// BEGIN AX REFUSAL', '// END AX REFUSAL')
        identity = block('// BEGIN AX IDENTITY', '// END AX IDENTITY')
        interaction = block('// BEGIN INTERACTION POLICY', '// END INTERACTION POLICY')
        methods = source[source.index('    private typealias AXIdentity ='):source.index('    func observe(pid:')]
        # All public AX names below are inert local stubs, never framework calls.
        stubs = r"""
typealias AXUIElement = CFString
typealias AXValue = CFArray
enum AXError: Int32 { case success = 0, failure = -25204; static var cannotComplete: AXError { .failure } }
enum AXValueType: Int { case cgPoint = 1, cgSize = 2, illegal = 0 }
let kAXWindowsAttribute = "AXWindows", kAXChildrenAttribute = "AXChildren"
let kAXRoleAttribute = "AXRole", kAXPositionAttribute = "AXPosition", kAXSizeAttribute = "AXSize"
let kAXFocusedUIElementAttribute = "AXFocusedUIElement", kAXFocusedAttribute = "AXFocused"
let kAXValueAttribute = "AXValue", kAXParentAttribute = "AXParent"
let kAXTitleAttribute = "AXTitle", kAXDescriptionAttribute = "AXDescription", kAXPlaceholderValueAttribute = "AXPlaceholderValue"
var systemHit = "button"
func AXUIElementCreateSystemWide() -> AXUIElement { token("system") }
func AXUIElementCopyElementAtPosition(_ system: AXUIElement, _ x: Float, _ y: Float,
    _ output: UnsafeMutablePointer<AXUIElement?>) -> AXError {
    calls.append("global:" + (system as String))
    guard system as String == "system", mode != "interaction_api_error", x == 25, y == 27 else { return .failure }
    output.pointee = token(systemHit);return .success
}
var attributes = [String: [String: AnyObject]]()
var mode = "", calls = [String]()
func token(_ name: String) -> CFString { name as CFString }
func value(_ kind: Int, _ x: Double, _ y: Double) -> CFArray { [kind, x, y] as CFArray }
func AXUIElementGetTypeID() -> CFTypeID { CFStringGetTypeID() }
func AXValueGetTypeID() -> CFTypeID { CFArrayGetTypeID() }
func AXUIElementCreateApplication(_ pid: pid_t) -> AXUIElement { token("app") }
func AXUIElementSetMessagingTimeout(_ element: AXUIElement, _ seconds: Float) -> AXError {
    calls.append("timeout:" + (element as String))
    return mode == "timeout" ? .failure : .success
}
func AXUIElementCopyAttributeValue(_ element: AXUIElement, _ name: CFString,
                                    _ result: UnsafeMutablePointer<CFTypeRef?>) -> AXError {
    let key = name as String
    calls.append((element as String) + ":" + key)
    if mode == "api_error" && key == "AXWindows" { return .failure }
    result.pointee = attributes[element as String]?[key]
    return .success
}
func AXUIElementGetPid(_ element: AXUIElement, _ result: UnsafeMutablePointer<pid_t>) -> AXError {
    calls.append("pid:" + (element as String)); result.pointee = element as String == "foreign" ? 500 : ["pid", "focus_pid"].contains(mode) ? 124 : 123
    return .success
}
func AXValueGetType(_ value: AXValue) -> AXValueType {
    AXValueType(rawValue: ((value as NSArray)[0] as! NSNumber).intValue)!
}
func AXValueGetValue(_ value: AXValue, _ type: AXValueType, _ pointer: UnsafeMutableRawPointer) -> Bool {
    if mode == "decode" { return false }
    let a = value as NSArray
    let x = (a[1] as! NSNumber).doubleValue, y = (a[2] as! NSNumber).doubleValue
    if type == .cgPoint { pointer.assumingMemoryBound(to: CGPoint.self).pointee = CGPoint(x: x, y: y) }
    else { pointer.assumingMemoryBound(to: CGSize.self).pointee = CGSize(width: x, height: y) }
    return true
}
func prepare(_ selected: String) {
    mode = selected; calls = []
    attributes = ["app": ["AXWindows": [token("root")] as NSArray],
                  "root": ["AXRole": "AXWindow" as NSString, "AXPosition": value(1, 10, 20),
                           "AXSize": value(2, 100, 30), "AXChildren": [] as NSArray]]
    if mode.hasPrefix("interaction_") {
        systemHit = mode == "interaction_foreign" ? "foreign" : mode == "interaction_owned_occluder" ? "other" : "button"
        let keyboard = mode.contains("keyboard") || mode.contains("focus_")
        attributes["button"] = ["AXRole": (keyboard ? "AXTextArea" : "AXButton") as NSString,
            "AXTitle": "Intended" as NSString, "AXPosition": value(1,20,25), "AXSize": value(2,20,10),
            "AXParent": token("root"), "AXFocused": kCFBooleanTrue, "AXValue": "owned" as NSString]
        attributes["foreign"] = attributes["button"];attributes["other"] = attributes["button"]
        attributes["other"]?["AXParent"] = token("unrelated")
        attributes["app"]?["AXFocusedUIElement"] = token("button")
        if mode == "interaction_ambiguous" {
            attributes["buttonChild"] = attributes["button"];attributes["buttonChild"]?["AXParent"] = token("button")
            systemHit = "buttonChild"
        }
        if mode == "interaction_moved" { attributes["button"]?["AXPosition"] = value(1,21,25) }
        if mode == "interaction_wrong_label" { attributes["button"]?["AXTitle"] = "Occluder" as NSString }
        if mode == "interaction_description" {
            attributes["button"]?["AXTitle"] = "" as NSString
            attributes["button"]?["AXDescription"] = "Intended" as NSString
        }
        if mode == "interaction_incidental_description" {
            attributes["button"]?["AXDescription"] = String(repeating:"wrong",count:300) as NSString
        }
        if mode.contains("placeholder") || mode == "interaction_identifier_only" {
            attributes["button"]?["AXTitle"] = "" as NSString
            attributes["button"]?["AXIdentifier"] = "Intended" as NSString
            if mode != "interaction_identifier_only" {
                attributes["button"]?["AXPlaceholderValue"] = mode.contains("wrong_type") ? 1 as NSNumber
                    : (mode.contains("wrong_name") ? "Wrong" : "Intended") as NSString
            }
        }
        if mode == "interaction_focus_target" { attributes["app"]?["AXFocusedUIElement"] = token("other") }
        if mode == "interaction_focus_value" { attributes["button"]?["AXValue"] = "wrong" as NSString }
        if mode == "interaction_focus_flag" { attributes["button"]?["AXFocused"] = 1 as NSNumber }
    }
    if mode.hasPrefix("focus_") {
        attributes["app"]?["AXFocusedUIElement"] = token("field")
        attributes["field"] = ["AXRole": "AXTextField" as NSString, "AXFocused": kCFBooleanTrue,
            "AXValue": "/owned/workspace with spaces" as NSString, "AXPosition": value(1,10,20),
            "AXSize": value(2,100,30), "AXParent": token("goTo")]
        if mode == "focus_cycle" { attributes["field"]?["AXParent"] = token("field") }
        if mode == "focus_foreign_ancestor" { attributes["field"]?["AXParent"] = token("foreign") }
        if mode == "focus_false" { attributes["field"]?["AXFocused"] = kCFBooleanFalse }
        if mode == "focus_number" { attributes["field"]?["AXFocused"] = 1 as NSNumber }
        if mode == "focus_role" { attributes["field"]?["AXRole"] = "AXSecureTextField" as NSString }
        if mode == "focus_zero" { attributes["field"]?["AXSize"] = value(2,0,30) }
        if mode == "focus_value_type" { attributes["field"]?["AXValue"] = 1 as NSNumber }
    }
    switch mode {
    case "missing": attributes["app"]?.removeValue(forKey: "AXWindows")
    case "type": attributes["app"]?["AXWindows"] = 1 as NSNumber
    case "member": attributes["app"]?["AXWindows"] = [1] as NSArray
    case "count": attributes["app"]?["AXWindows"] = Array(repeating: token("root"), count: 129) as NSArray
    case "frame": attributes["root"]?["AXPosition"] = value(1, 11, 20)
    case "encoding": attributes["root"]?["AXPosition"] = value(2, 10, 20)
    case "value_type": attributes["root"]?["AXPosition"] = 1 as NSNumber
    case "ambiguous":
        attributes["root2"] = attributes["root"]
        attributes["app"]?["AXWindows"] = [token("root"), token("root2")] as NSArray
    case "hierarchy":
        attributes["sheet"] = ["AXRole": "AXSheet" as NSString]
        attributes["root"]?["AXChildren"] = [token("sheet")] as NSArray
    case "foreign":
        attributes["other"] = ["AXRole": "AXButton" as NSString]
        attributes["app"]?["AXWindows"] = [token("root"), token("other")] as NSArray
    case "panel_valid", "goTo_valid", "nested_unexpected", "nested_missing":
        attributes["root"]?["AXChildren"] = [token("sheet")] as NSArray
        attributes["sheet"] = ["AXRole": "AXSheet" as NSString, "AXChildren": [] as NSArray]
        if mode == "goTo_valid" || mode == "nested_unexpected" {
            attributes["sheet"]?["AXChildren"] = [token("goTo")] as NSArray
            attributes["goTo"] = ["AXRole": "AXSheet" as NSString]
        }
    default: break
    }
}
"""
        driver = r"""
    func run() -> [String: Any] {
        if mode.hasPrefix("interaction_") {
            do {
                var binding = StartupNativeFolderPolicy.Binding<AXIdentity>()
                guard axSurface(.form,pid:123,frame:CGRect(x:10,y:20,width:100,height:30),binding:&binding) != nil else {
                    throw StartupAXReceiptError.refused
                }
                let stamp=DispatchTime.now().uptimeNanoseconds
                readDeadline = mode == "interaction_expired" ? stamp : stamp + 1_000_000_000
                let keyboard=mode.contains("keyboard") || mode.contains("focus_")
                let request=StartupAXInteractionRequest(schema:"nac342-ax-interaction-v1",nonce:String(repeating:"a",count:64),
                    configuration_sha256:String(repeating:"b",count:64),id:UUID().uuidString,root_id:rootID,
                    entered_ns:String(stamp),deadline_ns:String(stamp+30_000_000_000),baseline_sequence:"1",refusal_generation:"0",
                    surface:"form",kind:keyboard ? "message" : "button",label:"Intended",keyboard:keyboard,
                    point:[25,27],anchor_frame:[20,25,20,10],root_frame:[10,20,100,30],value:keyboard ? "owned" : nil)
                let first=try interaction(request,pid:123)
                if mode == "interaction_replaced" {
                    attributes["replacement"] = attributes["button"];systemHit="replacement"
                }
                let second=try interaction(request,pid:123)
                return ["accepted":first == second,"globals":calls.filter{$0 == "global:system"}.count]
            } catch { return ["accepted":false] }
        }
        if mode.hasPrefix("focus_") {
            return ["accepted": focusedGoToField(pid:123, sheet:token("goTo")) != nil]
        }
        var binding = StartupNativeFolderPolicy.Binding<AXIdentity>()
        let surface: StartupNativeFolderPolicy.Surface = ["goTo_valid", "nested_missing"].contains(mode) ? .goTo
            : ["panel_valid", "nested_unexpected"].contains(mode) ? .panel : .form
        if surface != .form {
            _ = binding.accept(.form, root: AXIdentity(element: token("root")), panel: nil, goTo: nil)
            if surface == .goTo {
                _ = binding.accept(.panel, root: AXIdentity(element: token("root")),
                                   panel: AXIdentity(element: token("sheet")), goTo: nil)
            }
        }
        let result = axSurface(surface, pid: 123, frame: CGRect(x: 10, y: 20, width: 100, height: 30), binding: &binding)
        let before = calls.count
        let first = axRefusal.record(binding: ["app_pid": 123, "window_number": 9])
        axRefusal.note("later_cause_must_not_overwrite")
        let after = axRefusal.record(binding: ["app_pid": 123, "window_number": 9])
        let bounded = axRefusal.record(binding: ["oversized": String(repeating: "X", count: 8193)]) == nil
        return ["accepted": result != nil, "record": first as Any? ?? NSNull(),
                "after": after as Any? ?? NSNull(), "bounded": bounded,
                "post_refusal_api_reads": calls.count - before, "calls": calls]
    }
}
let modes = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String]
let rows = modes.map { selected -> [String: Any] in prepare(selected); return Probe().run() }
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: rows))
"""
        swift = root / 'main.swift'
        swift.write_text('import Foundation\nimport CoreFoundation\nimport CoreGraphics\nimport Darwin\n'
                         + stubs + policy + interaction + diagnostic + identity + '\nprivate final class Probe {\n' + methods + driver)
        cls.binary = root / 'proof'
        result = subprocess.run(['swiftc', '-swift-version', '5', str(Path(__file__).with_name('StartupAXReceipt.swift')), str(swift), '-o', str(cls.binary)],
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stderr)

    def run_modes(self, modes):
        result = subprocess.run([str(self.binary)], input=json.dumps(modes), capture_output=True,
                                text=True, timeout=10, check=True)
        return json.loads(result.stdout)

    def test_exact_actor_uses_global_hits_and_retained_target_on_both_bookends(self):
        self.assertEqual(self.run_modes(['interaction_positive', 'interaction_keyboard_positive']),
                         [dict(accepted=True, globals=2)] * 2)
        self.assertEqual(self.run_modes(['interaction_description', 'interaction_incidental_description',
                                        'interaction_keyboard_placeholder']), [dict(accepted=True, globals=2)] * 3)


    def test_exact_actor_denies_foreign_owned_occluder_ambiguous_moved_replaced_and_expired_point(self):
        modes = ['foreign', 'owned_occluder', 'ambiguous', 'moved', 'wrong_label', 'replaced', 'expired', 'api_error', 'button_placeholder', 'identifier_only',
                 'keyboard_placeholder_wrong_type', 'keyboard_placeholder_wrong_name']
        self.assertEqual(self.run_modes(['interaction_' + m for m in modes]), [{'accepted':False}] * len(modes))

    def test_exact_actor_keyboard_requires_same_focused_handle_typed_focus_and_value(self):
        self.assertEqual(self.run_modes(['interaction_focus_target', 'interaction_focus_flag', 'interaction_focus_value']),
                         [{'accepted':False}] * 3)

    def test_distinct_first_failure_facts_preserve_nil_and_never_poll_after_refusal(self):
        modes = ['timeout', 'api_error', 'missing', 'type', 'member', 'count', 'frame',
                 'encoding', 'value_type', 'decode', 'ambiguous', 'hierarchy', 'pid', 'foreign']
        stages = ['application_timeout', 'attribute_error', 'attribute_missing', 'elements_type',
                  'elements_member_type', 'elements_count', 'root_frame_mismatch', 'frame_encoding',
                  'frame_value_type', 'frame_position_decode', 'root_matches', 'root_sheet_count',
                  'pid_mismatch', 'root_role_or_type']
        for mode, stage, row in zip(modes, stages, self.run_modes(modes)):
            with self.subTest(mode=mode):
                self.assertFalse(row['accepted'])
                self.assertFalse(row['record']['acceptance'])
                self.assertEqual(row['record']['first_observed_refusal']['stage'], stage)
                self.assertEqual(row['record'], row['after'])
                self.assertEqual(row['post_refusal_api_reads'], 0)
                self.assertTrue(row['bounded'])
                self.assertLessEqual(len(json.dumps(row['record'])), 8192)
                self.assertTrue(row['record']['terminal_refusal']['stage'])
        rows = self.run_modes(['api_error', 'ambiguous', 'frame', 'foreign'])
        self.assertEqual(rows[0]['record']['first_observed_refusal']['api_code'], -25204)
        self.assertEqual(rows[1]['record']['terminal_refusal']['count'], 2)
        self.assertEqual(rows[2]['record']['first_observed_refusal']['frame'], [11, 20, 100, 30])
        self.assertEqual(rows[3]['record']['terminal_refusal']['stage'], 'foreign_window')

    def test_focused_field_requires_typed_flag_role_pid_and_real_ancestor_walk(self):
        modes = ['focus_valid', 'focus_cycle', 'focus_foreign_ancestor', 'focus_false', 'focus_number',
                 'focus_role', 'focus_zero', 'focus_value_type', 'focus_pid']
        self.assertEqual([r['accepted'] for r in self.run_modes(modes)], [True] + [False] * (len(modes) - 1))

    def test_panel_and_goTo_hierarchy_acceptance_and_nested_refusals_stay_distinct(self):
        rows = self.run_modes(['panel_valid', 'goTo_valid', 'nested_unexpected', 'nested_missing'])
        self.assertEqual([row['accepted'] for row in rows], [True, True, False, False])
        self.assertEqual([row['record'] for row in rows[:2]], [None, None])
        for row, count in zip(rows[2:], [1, 0]):
            self.assertEqual(row['record']['terminal_refusal'], {'stage': 'nested_sheet_count', 'count': count})
            self.assertEqual(row['post_refusal_api_reads'], 0)

    def test_success_stays_accepted_without_failure_record(self):
        row = self.run_modes(['valid'])[0]
        self.assertTrue(row['accepted'])
        self.assertIsNone(row['record'])
        self.assertEqual(row['post_refusal_api_reads'], 0)


if __name__ == '__main__':
    unittest.main()
