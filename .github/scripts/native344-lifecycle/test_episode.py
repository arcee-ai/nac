"""Exercise real composition callbacks with inert transports, never native work."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import consumer as c
from test_consumer import admission, env, contract, owner, supervisor, H_STATIC
import episode
from test_ci_lifecycle_contract import case
from test_ci_lifecycle import fixture_receipt
from ci_lifecycle_contract import FRAMES
import ci
import ci_qualifications


class EpisodeCallbacks(unittest.TestCase):
    def exercise(self, fail=None, unknown=False):
        events = []
        original = Path(os.environ['LIFECYCLE_ORIGINAL_OUTER'])
        # Read only the genuine package body, without extracting/running it.
        _, _, body = c.handoff(original, admission())
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            product = root / 'product'; product.mkdir()
            output = root / 'episode'
            envvars = dict(env(), ROOT_LIFECYCLE_ADMISSION=json.dumps(admission()),
                H_ROOT=str(H_STATIC), P_ROOT=str(product), LIFECYCLE_OUTPUT=str(output),
                DOWNLOAD_ROOT=str(original), ImageVersion='20261102.0473.1')
            for label in ('PRODUCER_RUN_METADATA', 'PRODUCER_ARTIFACT_METADATA'):
                file = root / label; file.write_text('{}'); envvars[label] = str(file)

            def run(argv, log, cap, **kwargs):
                events.append(('helper', tuple(argv)))
                if argv[0] == '/usr/bin/ditto':
                    package = Path(argv[-1]); (package / body['bundle']['name']).mkdir()
                    (package / body['observer']['name']).write_bytes(b'INERT observer')
                if argv[:2] == ['xcrun', 'swiftc']: Path(argv[-1]).write_bytes(b'INERT image reader')
                log.write_text(json.dumps(dict(observed=True, locked=False)) if 'console' in argv else 'INERT helper\n')
                log.with_name(log.name + '.ownership.json').write_text(json.dumps(dict(
                    accepted=True, reaped=True, drain_settled=True, unknown=False, teardown_error=None)))

            def command(argv, **kwargs):
                if argv == ['/usr/bin/sw_vers', '-productVersion']: return '26.7.2'
                if argv == ['xcodebuild', '-version']: return 'Xcode 26.6\nBuild version 17F113'
                if argv == ['xcrun', '--sdk', 'macosx', '--show-sdk-version']: return '26.5'
                if argv == ['git', 'rev-parse', 'HEAD^']: return c.BASE
                if argv == ['/usr/bin/uname', '-a']: return 'INERT kernel'
                raise AssertionError('Unexpected helper ' + repr(argv))

            def driver(argv, log, environment, **kwargs):
                name = environment['NAC_LIFECYCLE_SCENARIOS']; events.append(('driver', name))
                destination = log.parent
                fixture_receipt(destination, name)
                owner.retain(destination, name)
                if name == fail: raise RuntimeError('INERT driver failed')
                summary = case(name, body['native_build_receipt'],
                    {n: row['sha256'] for n, row in body['source']['assets']['files'].items()}, destination)
                summary['source_head'] = c.P
                summary['cases'][0]['native'].update(ready_source=c.P, application_class='NACApplication')
                (destination / 'summary.json').write_text(json.dumps(summary))
                images = destination / name; images.mkdir()
                for frame in FRAMES: (images / frame).write_bytes(b'INERT PNG; NOT native image evidence')
                shutil.rmtree(destination / 'nac-lifecycle-app-fixture')
                return dict(state='exited', source_sha=c.P)

            def cleanup(destination, observer, command, **kwargs):
                events.append(('cleanup', destination.name))
                return dict(complete=not unknown, retained_failure_roots=[])

            # Inert H source fixture intentionally lacks this Swift source;
            # its immutable H blob is read from the recorded roster fixture.
            helper_source = H_STATIC / 'desktop/macos/CILifecycleImages.swift'
            self.assertTrue(helper_source.is_file())
            with ExitStack() as stack:
                stack.enter_context(mock.patch.dict(os.environ, envvars))
                stack.enter_context(mock.patch.object(c, 'admit', return_value=(1000, 3880, 4480, 4600)))
                stack.enter_context(mock.patch.object(c.common, 'make_clock', return_value=clock()))
                stack.enter_context(mock.patch.object(ci_qualifications, 'require_checkout'))
                stack.enter_context(mock.patch.object(ci, 'run', side_effect=run))
                stack.enter_context(mock.patch.object(ci, 'command', side_effect=command))
                stack.enter_context(mock.patch.object(c.launch, 'artifact_identity', return_value={'inert': True}))
                stack.enter_context(mock.patch.object(c, 'verify_package', return_value={'inert': True}))
                stack.enter_context(mock.patch.object(supervisor, 'run_case', side_effect=driver))
                stack.enter_context(mock.patch.object(supervisor, 'audit_cleanup', side_effect=cleanup))
                stack.enter_context(mock.patch.object(supervisor, 'image_report', side_effect=lambda argv, log, **kw:
                    dict(role=argv[1], readable=True, composited_paint_acceptance=False, trusted_input_acceptance=False)))
                # Existing finalizer's crash owner is retained but reads no host files here.
                stack.enter_context(mock.patch('ci_lifecycle_finalization.collect_crashes', return_value=[]))
                if fail or unknown:
                    with self.assertRaises(RuntimeError): episode.episode()
                else: episode.episode()
            report = json.loads((output / 'evidence/ci-report.json').read_bytes())
            ledger = json.loads((output / 'raw/lifecycle/ledger.json').read_bytes())
            return events, report, ledger

    def test_real_composition_reservation_validation_and_export_callbacks(self):
        events, report, ledger = self.exercise()
        self.assertEqual([event[1] for event in events if event[0] == 'driver'], list(c.CASES))
        self.assertEqual(ledger['phase'], 'complete')
        self.assertEqual(report['result'], 'passed')
        self.assertTrue(report['lifecycle_transactions_accepted'])
        self.assertFalse(report['full_G3_accepted'])
        self.assertFalse(report['composited_paint_acceptance'])

    def test_actual_failed_driver_and_unknown_cleanup_callbacks_stop_later_cases(self):
        for args in ({'fail': 'approval'}, {'unknown': True}):
            with self.subTest(args=args):
                events, report, ledger = self.exercise(**args)
                self.assertEqual([event[1] for event in events if event[0] == 'driver'],
                    ['run', 'approval'] if args.get('fail') else ['run'])
                self.assertEqual(report['result'], 'failed')
                self.assertNotEqual(ledger['phase'], 'complete')
                self.assertEqual(ledger['cases']['terminal'], dict(state='not_dispatched', dispatches=0))


def clock():
    from contextlib import nullcontext
    class Bound:
        deadline = float('inf')
        kind = 'work'
        def check(self): pass
        def capped(self, deadline): return self
    value = mock.Mock()
    value.work = Bound(); value.cleanup = Bound(); value.retention = Bound()
    return value


if __name__ == '__main__': unittest.main()
