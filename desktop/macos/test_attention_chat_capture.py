"""Capture ordering against the passive observation test fixture.

All process observations/capture calls are mocked; fake bytes are not images.
"""
import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import attention_app_smoke as driver
import test_attention_chat_deadlines as deadlines

class ExternalCaptureTests(unittest.TestCase):
    """Inherited deadline contracts plus actual external wrapper with fake OS."""
    setUp = deadlines.DeadlineTests.setUp

    def test_capture_only_after_ready_with_current_custody_within_deadline(self):
        for mode in ('click', 'not-ready', 'ready', 'stale-document', 'focus-loss', 'late-capture', 'slow-wrapper'):
            with self.subTest(mode=mode):
                self.clock.now = 0
                captures = []
                oldpublish = []
                doc = dict(launch='l', view='v', document='d')
                state = dict(stage='sample', app_pid=12, engine_pid=0, window_number=3, window_visible=True, document_binding=doc, route=driver.canonical_chat_route('id'), attention=dict(generation=1), chat_readiness=dict(ready=mode != 'not-ready', sample='sample', document=doc, generation=1, route=driver.canonical_chat_route('id'), session='id'))

                class Journey:

                    def read(self, **kw):
                        return state

                    def stage(self, *args, **kw):
                        return state

                    def launch(self):
                        pass

                    def observe(self, **kw):
                        return dict(apps=[])

                class Control:
                    identity = {'inert': True}

                    def publish(self, *args, **kw):
                        oldpublish.append(kw)
                fake = types.ModuleType('attention_app_smoke')
                fake.AttentionJourney = Journey
                fake.AttentionControl = Control
                fake.QuitProvider = type('Provider', (), {})
                fake.engine_settled = lambda *a: True
                fake.shutil = types.SimpleNamespace(rmtree=lambda *a, **kw: None)
                fake.request = lambda *a, **kw: None
                fake.console_facts = lambda **kw: {}
                fake.canonical_chat_route = driver.canonical_chat_route
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    journey = Journey()
                    journey.output = root / 'first/native.json'
                    journey.chat_deadline = 20
                    journey.root = root

                    def custody(*args, **kw):
                        if mode == 'focus-loss':
                            raise AssertionError('focus changed')
                    journey.custody = types.SimpleNamespace(check=custody)
                    spec = importlib.util.spec_from_file_location('external_observer', Path(__file__).parent / 'test_support/attention_chat_observation.py')
                    observer = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(observer)

                    def check_output(argv, **kw):
                        self.assertLessEqual(kw['timeout'], 2)
                        if mode == 'slow-wrapper':
                            self.clock.advance(3)
                        return 'h' if argv[1:] == ['rev-parse', 'HEAD'] or argv[1:] == ['rev-parse', 'h^{commit}'] else 't' if argv[1:] == ['rev-parse', 'h^{tree}'] else ''

                    def capture(argv, **kw):
                        if argv[0] == '/bin/ps':
                            return types.SimpleNamespace(returncode=0, stdout='inert owned process', stderr=b'')
                        self.assertEqual(argv[0], '/usr/sbin/screencapture')
                        self.assertLessEqual(kw['timeout'], 2)
                        captures.append(argv)
                        Path(argv[-1]).write_bytes(b'inert frame marker; not an image')
                        if mode == 'late-capture':
                            self.clock.advance(3)
                        return types.SimpleNamespace(returncode=0, stderr=b'')
                    with patch.dict(sys.modules, attention_app_smoke=fake), patch.object(observer.subprocess, 'check_output', side_effect=check_output), patch.object(observer.subprocess, 'run', side_effect=capture):
                        observer.install(root, 'h', 't')
                        control = Control()
                        if mode == 'slow-wrapper':
                            with self.assertRaises(TimeoutError):
                                control.publish(journey, 'sample', 'inspect-chat', deadline=2)
                            self.assertEqual(oldpublish, [])
                            continue
                        control.publish(journey, 'sample', 'click' if mode == 'click' else 'inspect-chat', deadline=2)
                        if mode == 'stale-document':
                            state['document_binding'] = {'document': 'old'}
                        if mode in ('stale-document', 'focus-loss', 'late-capture'):
                            with self.assertRaises((AssertionError, TimeoutError)):
                                journey.stage('sample', timeout=2, deadline=2)
                        else:
                            journey.stage('sample', timeout=2, deadline=2)
                    self.assertEqual(len(captures), 1 if mode in ('ready', 'late-capture') else 0)
                    frames = root / 'observations/frames.jsonl'
                    self.assertEqual(frames.exists(), mode == 'ready')
if __name__ == '__main__':
    unittest.main(verbosity=2)
