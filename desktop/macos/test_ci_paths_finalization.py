"""Injected actual path finalizer controls; no native commands are executed."""
from contextlib import ExitStack, contextmanager
import json
from pathlib import Path
import plistlib
import tempfile
import time
import unittest
from unittest.mock import patch

import ci_paths
from ci_paths_protocol import CASES, PRODUCT


class CaseFinalizationControls(unittest.TestCase):
    def exercise(self, *, scenario=CASES[0], test_error=False, export_error=False,
                 cleanup_error=False, build_error=False, missing_result=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            raw = root / 'raw'; raw.mkdir()
            app = root / 'NAC Development Preview Smoke.app'; app.mkdir()
            (app / 'fixture-only.txt').write_text('Pure unit fixture, not an app/binary')
            source = root / 'source.swift'; source.write_text('// injected compiler input only')
            selection = dict(project='/synthetic/maintained.xcodeproj', scheme='NACPathUITests',
                             receipt=dict(sources={str(source): ci_paths.digest(source.read_bytes())}))
            relocation = dict(path=root/'nac-mac-relocation-unit', safe_to_remove=True)
            relocation['path'].mkdir()
            commands, cleanup_calls, collect_calls = [], [], []
            config_seen = {}
            @contextmanager
            def lease(_):
                yield relocation
            def run(argv, log, timeout):
                commands.append(argv)
                if 'build-for-testing' in argv:
                    if build_error:
                        raise RuntimeError('Injected build failure, no SDK invoked')
                    derived = Path(argv[argv.index('-derivedDataPath')+1])
                    folder = derived/'Build/Products';folder.mkdir(parents=True)
                    (folder/'only.xctestrun').write_bytes(plistlib.dumps({'synthetic': True}))
                else:
                    config = json.loads((raw/scenario/'configuration.json').read_text())
                    config_seen.update(config)
                    evidence=Path(config['evidence'])
                    native = (dict(finder_observation_grace_seconds=45, finder_cleanup_residual='left open',
                                   created_session={'id':'synthetic'}, reveal_observation={'count':1})
                              if scenario==CASES[0] else dict(actual_failure='synthetic engine failure',
                                   launch_identity_retired=True, path_bridge_after_failure=dict(installed=False,pending=False)))
                    evidence.write_text(json.dumps(dict(scenario=scenario,passed=True,engine_reaped=True,
                                                         profile_removed=True,native_paths=native)))
                    if not missing_result:
                        Path(argv[argv.index('-resultBundlePath')+1]).mkdir()
                    if test_error:
                        raise TimeoutError('Injected test timeout, no process started')
            def collect(*args, **kwargs):
                collect_calls.append(kwargs['passing'])
                if export_error:
                    raise RuntimeError('Injected SDK export failure, no SDK invoked')
                return dict(scope={'run':'synthetic'},inputs=[{'index':1}],complete=not test_error)
            def settle(*args):
                cleanup_calls.append(args)
                if cleanup_error or args[2] is None:
                    raise RuntimeError('Injected missing/unsettled custody; preserve relocated root')
                return dict(app_engine_settled=True,profile_removed=True)
            with ExitStack() as stack:
                stack.enter_context(patch('ci_paths.relocation_directory',lease))
                stack.enter_context(patch('ci_paths.require_checkout'))
                stack.enter_context(patch('ci_paths.verify_build',return_value=dict(native_sha256='b'*64,engine_sha256='c'*64)))
                stack.enter_context(patch('ci_paths.observe_prerequisites',return_value={'synthetic':'unchanged'}))
                stack.enter_context(patch('ci_paths.authorization_policy',return_value={'policy':'unchanged'}))
                stack.enter_context(patch('ci_paths.require_generated_runner',return_value={'synthetic':True}))
                stack.enter_context(patch('ci_paths.AttachmentTool'))
                stack.enter_context(patch('ci_paths.result_receipt',return_value={'files':1,'tree_sha256':'d'*64}))
                stack.enter_context(patch('ci_paths.collect',side_effect=collect))
                stack.enter_context(patch('ci_paths.settle_case',side_effect=settle))
                if any((test_error,export_error,cleanup_error,build_error,missing_result)):
                    with self.assertRaisesRegex(RuntimeError,'path case failed'):
                        ci_paths.run_case(raw,root,app,selection,'a'*40,scenario,run,
                                          lambda _: self.fail('Unexpected uninjected native command'),lambda _:None,time.time()+1000)
                else:
                    result=ci_paths.run_case(raw,root,app,selection,'a'*40,scenario,run,
                                            lambda _:self.fail('Unexpected uninjected native command'),lambda _:None,time.time()+1000)
                    self.assertTrue(result['passed'])
            essential=json.loads((raw/scenario/'essential.json').read_text())
            self.assertFalse((raw/scenario/'derived').exists())
            self.assertFalse(essential['native_acceptance'])
            self.assertTrue(essential['Finder_window_left_open'])
            if build_error:
                self.assertFalse(essential['attempted']);self.assertFalse(cleanup_calls)
                self.assertTrue(relocation['safe_to_remove'])
            else:
                self.assertTrue(essential['attempted']);self.assertEqual(len(cleanup_calls),1)
                self.assertEqual(cleanup_calls[0][0],Path(config_seen['evidence']))
                self.assertEqual(cleanup_calls[0][1],Path(config_seen['app_path']))
                self.assertIn('--smoke-scenario', (Path(__file__).parent/'NativeUITests/PathJourneys.swift').read_text())
                self.assertIn('-only-testing:NACPathUITests/PathJourneys/'+ci_paths.TESTS[CASES.index(scenario)],commands[-1])
            if export_error or cleanup_error or missing_result:
                self.assertTrue(essential['retained_bundle']);self.assertFalse(relocation['safe_to_remove'])
                self.assertIn('cleanup',essential['errors'])
            if export_error:
                self.assertIn('collector',essential['errors'])
            if test_error and not export_error and not cleanup_error:
                self.assertFalse(essential['retained_bundle']);self.assertTrue(relocation['safe_to_remove'])
                self.assertEqual(collect_calls,[False])
            return essential

    def test_both_cases_keep_actual_test_selection_and_separate_native_acceptance(self):
        for scenario in CASES:
            with self.subTest(scenario=scenario):self.exercise(scenario=scenario)

    def test_timeout_still_collects_partial_proof_and_attempts_exact_owned_cleanup(self):
        self.exercise(test_error=True)

    def test_export_failure_still_attempts_cleanup_and_missing_proof_retains_root(self):
        self.exercise(export_error=True)

    def test_cleanup_failure_retains_bundle_and_cannot_pass(self):
        self.exercise(cleanup_error=True)

    def test_missing_result_retains_root_without_inferred_input_or_cleanup_proof(self):
        self.exercise(missing_result=True)

    def test_build_failure_never_requests_input_or_actor_cleanup(self):
        self.exercise(build_error=True)


class StageBudgetControls(unittest.TestCase):
    def test_shared_original_build_native_and_cleanup_caps_and_first_failure_order(self):
        for first_failure in (False, True):
            with self.subTest(first_failure=first_failure), tempfile.TemporaryDirectory() as temporary:
                calls = []
                def case(*args, **kwargs):
                    calls.append((args[5], args[9], kwargs['build_deadline']))
                    if first_failure:
                        raise RuntimeError('Injected first case failure, no native input')
                    return dict(passed=True)
                with patch('ci_paths.require_checkout'), patch('ci_paths.materialize_project', return_value={}), \
                        patch('ci_paths.verify_build', return_value={'synthetic': True}), \
                        patch('ci_paths.time.time', return_value=1100), \
                        patch.dict(ci_paths.os.environ, CARGO_BUILD_JOBS='2'), \
                        patch('ci_paths.run_case', side_effect=case):
                    def qualify():
                        return ci_paths.qualify(Path(temporary), Path('/synthetic-T'), ci_paths.TARGET,
                            'a'*40, lambda *args, **kwargs: None, lambda _: None, lambda _: None,
                            dict(started_at_epoch=1000, deadline_epoch=3700))
                    if first_failure:
                        with self.assertRaisesRegex(RuntimeError, 'first case failure'): qualify()
                    else:
                        self.assertTrue(qualify()['paths']['two_cases_complete'])
                self.assertEqual(len(calls), 1 if first_failure else 2)
                self.assertEqual([row[0] for row in calls], list(CASES[:len(calls)]))
                self.assertTrue(all(native == 2000 and build == 2200 for _, native, build in calls))
                self.assertLessEqual(calls[0][1] - 1100, 900)
                self.assertLessEqual(calls[0][2] - 1000, 1200)
                self.assertGreaterEqual(3700 - calls[0][1], 600)


if __name__=='__main__':unittest.main()
