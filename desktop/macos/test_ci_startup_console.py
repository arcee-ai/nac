"""Source-bound successful Q trace; synthetic collector controls, never native proof."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

from ci_startup_attachments import StartupAttachmentError, collect, require_observation
from ci_startup_fixture import CASES, TEST_FILES, operations
from ci_xctest_attachments import digest
from test_ci_startup_attachments import StartupAttachmentTests


class StartupConsoleTests(unittest.TestCase):
    def source_trace(self, case):
        path = os.environ.get('NAC_STARTUP_TEST_SOURCE')
        if not path:
            self.skipTest('Explicit immutable Q StartupJourneys.swift required for source trace')
        data = Path(path).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), TEST_FILES['StartupJourneys.swift'])
        source = data.decode()
        # Use the producer's existing pure decision and verify callback seams.
        title = source.split('// BEGIN ONBOARDING TITLE', 1)[1].split('// END ONBOARDING TITLE', 1)[0]
        self.assertEqual(title.count('verify()'), 1)
        self.assertIn('frame.intersects(bounds) && verify()', title)
        window = source.split('private func guardWindow(', 1)[1].split('private func queryDiagnostic(', 1)[0]
        self.assertEqual(window.count('observations.append(try console())'), 1)
        main = source.split('func testOrdinaryStartup() throws {', 1)[1]
        self.assertEqual(main.count('observations.append(try console())'), 1)
        guard = main.split('func guardTarget() throws {', 1)[1].split('func dispatch(', 1)[0]
        self.assertEqual(guard.count('try guardWindow('), 1)
        dispatch = main.split('func dispatch(', 1)[1].split('func text(', 1)[0]
        self.assertEqual(dispatch.count('try guardTarget()'), 2)
        for anchor in ('try guardTarget()\n        initialGuardPending = false\n        if ["invalidConfig", "futureStore"]',
                       'try guardTarget()\n        let screenshot',
                       'try guardTarget()\n        if let axClient'):
            self.assertEqual(main.count(anchor), 1)
        proof = main.split('try guardTarget()\n        if let axClient', 1)[1].split('let expectedPrivateFailure', 1)[0]
        self.assertNotIn('try guardTarget()', proof)
        self.assertIn('axClient.evidence.count == 26', proof)
        callback = main.split('}, window: { window.frame }, verify: {', 1)[1].split('})', 1)[0]
        self.assertEqual(callback.count('(try? guardTarget())'), 1)
        self.assertIn('Data(contentsOf: URL(fileURLWithPath: path))) == bytes', callback)
        self.assertEqual(main.count('StartupOnboardingTitle.visible('), 1)
        self.assertLess(main.index('if ["invalidConfig", "futureStore"]'), main.index('StartupOnboardingTitle.visible('))
        trace = ['prelaunch-console', 'before-scenario']
        if case in ('onboarding', 'configuredLocal'):
            trace.append('title-verify-guard')
        for operation in operations({'scenario': case, 'home': '/private/owned home'}):
            trace.extend([operation + ':before', operation + ':after'])
        return trace + ['before-screenshot', 'after-screenshot']

    def producer_fixture(self, case):
        fixture = StartupAttachmentTests()
        config, config_hash, witness, rows = fixture.fixture(case)
        observation = json.loads(rows[-2][1])
        # Pure exporter controls use the local fixture, independent of external Q.
        return fixture, config, config_hash, witness, rows, observation

    def test_current_title_verify_adds_exactly_one_guard_to_successful_normal_cases(self):
        if not os.environ.get('NAC_STARTUP_TEST_SOURCE'):
            self.skipTest('Optional local Q trace not supplied; required CI uses ci_startup_console_check')
        for case, count in (('onboarding', 5), ('configuredLocal', 27), ('invalidConfig', 4), ('futureStore', 4)):
            with self.subTest(case=case):
                trace = self.source_trace(case)
                self.assertEqual(len(trace), count)
                self.assertEqual(trace.count('title-verify-guard'), int(case in ('onboarding', 'configuredLocal')))

    def test_current_producer_shaped_exports_complete_all_exact_scenarios(self):
        for case in CASES:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                raw = Path(temporary)
                fixture, config, config_hash, witness, rows, observation = self.producer_fixture(case)
                index = collect(fixture.tool(raw, rows), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                self.assertTrue(index['complete'])
                self.assertEqual(index['observation']['console'], observation['console'])
                self.assertEqual(len(index['dispatches']), 2 * len(operations(config)))
                self.assertEqual(digest((raw / 'selected' / f'nac342-ordinary-{case}.png').read_bytes()), observation['png_sha256'])

    def test_missing_extra_and_legacy_counts_never_retain_final_payloads(self):
        for case in CASES:
            for delta in (-1, 1):
                with self.subTest(case=case, delta=delta), tempfile.TemporaryDirectory() as temporary:
                    raw = Path(temporary)
                    fixture, config, config_hash, witness, rows, observation = self.producer_fixture(case)
                    console = observation['console']
                    observation['console'] = console[:-1] if delta < 0 else [*console, copy.deepcopy(console[0])]
                    rows[-2] = (rows[-2][0], json.dumps(observation).encode())
                    with self.assertRaisesRegex(StartupAttachmentError, 'console_count'):
                        collect(fixture.tool(raw, rows), raw / 'unit.xcresult', config, config_hash, witness, raw / 'selected')
                    index = json.loads((raw / 'selected/index.json').read_text())
                    self.assertFalse(index['complete'])
                    self.assertEqual(index['collection_error']['reason'], 'console_count')
                    self.assertFalse((raw / 'selected' / f'nac342-ordinary-{case}.png').exists())
                    self.assertFalse((raw / 'selected' / f'nac342-ordinary-v1-{case}.json').exists())

    def test_every_console_witness_and_scenario_binding_remain_strict(self):
        for case in CASES:
            _, config, config_hash, witness, _, observation = self.producer_fixture(case)
            png = {'sha256': observation['png_sha256']}
            for index in range(len(observation['console'])):
                for changed in ({'root_locked': True}, {'session_lock_flag': True}, {'quartz_lock_flag': True},
                                {'on_console': False}, {'login_done': False}, {'session_lock_flag': 0},
                                {'rendered_app_qualification_required': False}):
                    bad = copy.deepcopy(observation)
                    bad['console'][index].update(changed)
                    with self.subTest(case=case, index=index, changed=changed), self.assertRaisesRegex(StartupAttachmentError, 'console_positive_observation'):
                        require_observation(bad, config, config_hash, witness, png)
            for console in (None, {}, 5, [True] * len(observation['console']), [{}] * len(observation['console'])):
                with self.subTest(case=case, malformed=console), self.assertRaises(StartupAttachmentError):
                    require_observation({**observation, 'console': console}, config, config_hash, witness, png)
            wrong = next(scenario for scenario in CASES if scenario != case)
            with self.assertRaisesRegex(StartupAttachmentError, 'observation_binding'):
                require_observation({**observation, 'scenario': wrong}, config, config_hash, witness, png)
