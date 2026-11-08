"""Actual main with inert ports and temporary JSON/files only; no OS actors.

The actual controller and episode execute. Imports for H services are isolated
fake modules: no app, engine, AX, command, compiler, signal, SQLite or network.
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostic_main_control', Path(__file__).with_name('preflight.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class BudgetExpired(RuntimeError):
    pass


class MainReceiptControls(unittest.TestCase):
    def exercise(self, mode):
        events = []
        expired = BudgetExpired('original outer work exit')
        ordinary = ValueError('original final checkout failure')
        real_digest = p.digest
        pair = json.loads((p.HERE / 'pair.json').read_text())
        clock = SimpleNamespace(cleaning=False, failed=[])
        clock.work = SimpleNamespace(kind='work', deadline=1)
        clock.cleanup = SimpleNamespace(kind='cleanup', deadline=2)
        clock.retention = SimpleNamespace(kind='retention', deadline=3)
        clock.require_phase = lambda *args: None
        clock.fail = lambda reason: clock.failed.append(reason) if reason not in clock.failed else None
        depths = dict(work=0, cleanup=0, retention=0)

        @contextlib.contextmanager
        def using(bound):
            kind = bound.kind
            depths[kind] += 1
            outer_work = kind == 'work' and depths[kind] == 1
            try:
                yield
                # Same port behavior as H's using: the bound checks AGAIN after
                # successful body completion. Do not manufacture report values.
                if outer_work and mode == 'expired_exit':
                    self.assertIn('profile_removed', events)
                    events.append('outer_work_expired')
                    clock.fail('work: original bound expired')
                    raise expired
            finally:
                depths[kind] -= 1

        def module(name, **values):
            result = ModuleType(name)
            result.__dict__.update(values)
            return result

        with tempfile.TemporaryDirectory(prefix='nac-ax-main-inert-') as temporary:
            root = Path(temporary).resolve()
            controller = root / 'controller'
            here = controller / '.github/scripts/native-ax-preflight'
            here.mkdir(parents=True)
            (here / 'pair.json').write_text(json.dumps(pair))
            roots = {k: root / k for k in ('H', 'P', 'Q')}
            for directory in roots.values():
                directory.mkdir()
            desktop = roots['H'] / 'desktop/macos'
            desktop.mkdir(parents=True)
            (desktop / 'ci-toolchain.json').write_text('{}')
            (desktop / 'CIStartupObserver.swift').write_text('inert source, never compiled')
            package = root / 'package'
            package.mkdir()
            (package / 'manifest.json').write_text('{}')
            output = root / 'episode'
            profile = dict(root=root / 'fixture')
            config_path = root / 'configuration.json'
            config_path.write_text('{}')
            config = dict(app_path=str(root / 'fixture/NAC.app'), home=str(root / 'fixture/home'), environment={})

            def owned_run(argv, log, cap, **kwargs):
                events.append('inert_owned_callback')
                log.write_text('inert; no process started')
                log.with_name(log.name + '.ownership.json').write_text(json.dumps(dict(
                    accepted=True, reaped=True, drain_settled=True, unknown=False, teardown_error=None)))
                if '-o' in argv:
                    Path(argv[argv.index('-o') + 1]).write_bytes(b'inert helper, never executed')

            def checkout(*args):
                if clock.cleaning:
                    events.append('final_checkout')
                    if mode == 'ordinary_failure':
                        raise ordinary

            class Witness:
                def __init__(self, *args):
                    self.ready = False
                    self.history = {}
                    self.failure = None
                def start(self, *args):
                    events.append('observer')
                    self.ready = True
                def settle(self, *args):
                    events.append('settlement')
                    return dict(root=str(profile['root']), owned_processes_settled=True)
                def stop(self):
                    events.append('observer_stopped')

            def capture(*args, **kwargs):
                events.append('inert_capture_callback')
                return dict(acceptance=False, trusted=True, bound=True, identity_rechecked=True)

            def export(raw, exported, *args, **kwargs):
                self.assertEqual(depths['retention'], 1)
                events.append('retention_export')
                shutil.copyfile(raw / 'preflight.json', exported / 'preflight.json')

            fake_modules = {
                'ci': module('ci', command=lambda *a, **k: 'inert toolchain', run=owned_run),
                'ci_startup': module('ci_startup', PRODUCT=pair['P'], TEST_SOURCE=pair['Q'],
                    prepare_profile=lambda *a, **k: profile,
                    prepare_configuration=lambda *a, **k: (config, config_path, dict(normal=True)),
                    test_contract=lambda *a: None, package_contract=lambda *a, **k: dict(normal=True),
                    immutable_snapshot=lambda *a: {}, cleanup_receipt=lambda x: x,
                    require_integrity=lambda *a: events.append('integrity'),
                    remove_profile=lambda *a: events.append('profile_removed')),
                'ci_startup_owner': module('ci_startup_owner', OwnerWitness=Witness, capture_ax_preflight=capture),
                'ci_paths_budget': module('ci_paths_budget', Bound=object, using=using),
                'ci_qualifications': module('ci_qualifications', require_checkout=checkout),
                'ci_support': module('ci_support', export_evidence=export,
                    qualify_toolchain=lambda *a: None, redact_values=lambda: []),
                'ci_xctest': module('ci_xctest', runner_environment=lambda: {}),
            }
            environment = dict(GITHUB_REF=p.BRANCH, GITHUB_EVENT_NAME='workflow_dispatch',
                GITHUB_RUN_ATTEMPT='1', GITHUB_REPOSITORY='arcee-ai/nac', GITHUB_SHA='a' * 40,
                ROOT_STARTUP_ADMISSION=json.dumps(dict(controller_sha='a' * 40)),
                PACKAGE_ROOT=str(package), OUTPUT_ROOT=str(output), ImageVersion=pair['host_image'],
                **{k + '_ROOT': str(v) for k, v in roots.items()})
            caught = None
            # Inert admission/clock ports are explicit. Synthetic values here
            # grant no Root allocation and can never reach any real H module.
            with patch.dict(os.environ, environment), patch.dict(sys.modules, fake_modules), \
                 patch.object(p, 'HERE', here), patch.object(p, 'admit', return_value=(0, 0, 0, 0)), \
                 patch.object(p, 'make_clock', return_value=clock), \
                 patch.object(p, 'wait_owned', return_value=dict(owned_incarnation_verified=True)), \
                 patch.object(p, 'digest', side_effect=lambda file: p.MANIFEST if Path(file).name == 'manifest.json' else real_digest(file)), \
                 patch.object(sys, 'argv', ['inert-main']), patch.object(sys, 'path', list(sys.path)), \
                 patch.object(p.platform, 'system', return_value='Darwin'), \
                 patch.object(p.platform, 'machine', return_value='arm64'):
                try:
                    p.main()
                except BaseException as error:
                    caught = error
            raw = json.loads((output / 'raw/preflight.json').read_bytes())
            exported = json.loads((output / 'evidence/preflight.json').read_bytes())
            self.assertEqual(raw, exported)
            self.assertIs(exported['acceptance'], False)
            self.assertEqual(exported['diagnostic']['status'], 'GO')
            self.assertTrue(exported['diagnostic']['cleanup'])
            self.assertTrue(exported['diagnostic']['profile_removed'])
            self.assertEqual(events.count('inert_capture_callback'), 1)
            self.assertEqual(events.count('profile_removed'), 1)
            self.assertEqual(events[-1], 'retention_export')
            return exported, events, caught, expired, ordinary

    def test_successful_episode_then_work_exit_expiry_exports_no_go_and_original_exception(self):
        report, events, caught, expired, _ = self.exercise('expired_exit')
        self.assertIs(caught, expired)
        self.assertEqual(report['status'], 'NO_GO')
        self.assertEqual(report['error_type'], 'BudgetExpired')
        self.assertIn('diagnostic failed/unknown', report['clock_failures'])
        self.assertLess(events.index('profile_removed'), events.index('outer_work_expired'))

    def test_successful_work_exit_retains_go_without_acceptance_credit(self):
        report, _, caught, _, _ = self.exercise('success')
        self.assertIsNone(caught)
        self.assertEqual(report['status'], 'GO')
        self.assertNotIn('error_type', report)
        self.assertEqual(report['clock_failures'], [])

    def test_ordinary_main_failure_exports_no_go_and_preserves_original_exception(self):
        report, events, caught, _, ordinary = self.exercise('ordinary_failure')
        self.assertIs(caught, ordinary)
        self.assertEqual(report['status'], 'NO_GO')
        self.assertEqual(report['error_type'], 'ValueError')
        self.assertIn('diagnostic failed/unknown', report['clock_failures'])
        self.assertIn('profile_removed', events)


if __name__ == '__main__':
    unittest.main()
