"""Inert controls for the exact post-crash focus boundary; no UI or signals."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from instance_smoke import app_crash_case


class CrashFocusReceiptTests(unittest.TestCase):
    def test_one_observation_is_recorded_and_used_before_replacement(self):
        prior = dict(pid=1, bundle='fixture.prior', launch_time=10.0)
        fixture = dict(pid=2, bundle='fixture.app', launch_time=20.0)
        foreign = dict(pid=3, bundle='fixture.foreign', launch_time=30.0)
        for observed in (prior, foreign, None):
            with self.subTest(observed=observed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                app, case, profile = root / 'Fixture.app', root / 'case', root / 'profile'
                for path in [app / 'Contents/MacOS', app / 'Contents/Resources', case, profile]:
                    path.mkdir(parents=True)
                (app / 'Contents/MacOS/NACPreview').write_bytes(b'fixture-native')
                (app / 'Contents/Resources/nac-web').write_bytes(b'fixture-engine')
                (app / 'Contents/Resources/engine-identity.json').write_text(json.dumps({'source_revision': 'a'*40}))
                store = str((profile / 'selected store.db').resolve())
                first = Mock(identity=fixture, prior=prior)
                first.observe.side_effect = [dict(apps=[]), dict(frontmost=observed)]
                first.stage.return_value = dict(engine_pid=17, launch_incarnation='first', ready_store=store)
                second = Mock(identity=dict(pid=4, bundle='fixture.app', launch_time=40.0))
                second.stage.return_value = dict(launch_incarnation='second', ready_store=store)
                second.finish.return_value = {}

                def wait(_label, predicate, **_):
                    self.assertTrue(predicate())

                with patch('instance_smoke.environment', return_value={}), \
                        patch('instance_smoke.AppJourney', side_effect=[first, second]) as journeys, \
                        patch('instance_smoke.subprocess.check_output', return_value=b'{"termination_requested":true}'), \
                        patch('instance_smoke.wait_for', side_effect=wait), \
                        patch('instance_smoke.engine_settled', return_value=True), \
                        patch('instance_smoke.time.monotonic', return_value=123.5):
                    if observed == prior:
                        app_crash_case(app, case, profile, Path('/inert-observer'), [])
                        self.assertEqual(journeys.call_count, 2)
                        second.launch.assert_called_once_with()
                        second.cleanup.assert_called_once_with()
                    else:
                        with self.assertRaisesRegex(AssertionError, 'Focus changed after fixture crash'):
                            app_crash_case(app, case, profile, Path('/inert-observer'), [])
                        self.assertEqual(journeys.call_count, 1)
                        self.assertFalse((case / 'replacement').exists())
                        second.launch.assert_not_called()
                first.cleanup.assert_called_once_with()
                self.assertEqual(first.observe.call_count, 2, 'Never resample until focus matches')
                receipt = json.loads((case / 'post-crash-focus.json').read_text())
                self.assertEqual(receipt['prior'], prior)
                self.assertEqual(receipt['fixture_identity'], fixture)
                self.assertEqual(receipt['observed'], observed)
                self.assertEqual(receipt['monotonic'], 123.5)
                self.assertEqual(receipt['source_revision'], 'a'*40)
                self.assertEqual(receipt['native_sha256'], hashlib.sha256(b'fixture-native').hexdigest())
                self.assertEqual(receipt['engine_sha256'], hashlib.sha256(b'fixture-engine').hexdigest())
                self.assertEqual(len(receipt['controller_sha256']), 64)
                self.assertLessEqual((case / 'post-crash-focus.json').stat().st_size, 16*1024)


if __name__ == '__main__':
    unittest.main()
