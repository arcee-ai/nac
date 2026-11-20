import unittest
from urllib.error import HTTPError
from probe import exercise
from summarize import summarize


class Provider:
    def __init__(self):
        self.settled = False
        self.stopped = False
    def start(self):
        return 'private-endpoint'
    def stop(self, require_complete=True):
        assert not require_complete
        self.stopped = self.settled = True


class Tests(unittest.TestCase):
    def test_idle_never_constructs_provider(self):
        self.assertEqual(exercise('idle', lambda: self.fail(), lambda *_: self.fail(), lambda _: None)['operation'], 'completed')

    def test_provider_and_loopback_are_distinct_and_reaped(self):
        for cell in ('provider', 'loopback'):
            instance, calls = Provider(), []
            def request(*args):
                calls.append(args)
                raise HTTPError('private', 404, 'private', {}, None)
            result = exercise(cell, lambda: instance, request, lambda _: None)
            self.assertEqual(len(calls), int(cell == 'loopback'))
            self.assertTrue(instance.stopped)
            self.assertEqual(result['owned_provider_settlement'], 'settled')
            self.assertNotIn('private', str(result))

    def test_failure_is_redacted_and_still_stopped(self):
        instance = Provider()
        def fail(*_):
            raise RuntimeError('secret')
        result = exercise('loopback', lambda: instance, fail, lambda _: None)
        self.assertEqual(result['operation'], 'unavailable')
        self.assertTrue(instance.stopped)
        self.assertNotIn('secret', str(result))

    def test_observation_cannot_prove_modal_absent(self):
        self.assertEqual(summarize('idle', ['other_frontmost', 'private'], 'completed')['modal'], 'unknown')
        self.assertEqual(summarize('idle', ['notification_center_frontmost'], 'completed')['frontmost_observation'], 'notification_center_seen')
        self.assertEqual(summarize('idle', ['other_frontmost'], 'completed')['frontmost_observation'], 'unknown')
        self.assertEqual(summarize('idle', ['network_dialog_detected'], 'completed')['modal'], 'known_dialog_detected')

if __name__ == '__main__':
    unittest.main()
