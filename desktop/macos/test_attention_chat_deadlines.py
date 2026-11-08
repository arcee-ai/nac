"""Pure/inert source contracts. No native process, console, app, or capture."""
import ast, json, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'desktop/macos'))
import instance_smoke as inst
import attention_fixture_control as ctrl
import attention_app_smoke as driver

class Clock:

    def __init__(self):
        self.now = 0

    def advance(self, n):
        self.now += n

def nested_driver():
    tree = ast.parse((ROOT / 'desktop/macos/attention_app_smoke.py').read_text())
    owner = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_contract'))
    body = ast.parse('sequence=0').body + [n for n in owner.body if isinstance(n, ast.FunctionDef) and n.name in ('command', 'chat_ready')]
    body += ast.parse('return command,chat_ready').body
    factory = ast.FunctionDef(name='factory', args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]), body=body, decorator_list=[])
    module = ast.fix_missing_locations(ast.Module(body=[factory], type_ignores=[]))
    env = dict(vars(driver))
    exec(compile(module, 'actual-driver-closures', 'exec'), env)
    return env['factory']()

class DeadlineTests(unittest.TestCase):

    def setUp(self):
        self.clock = Clock()
        self.patch = patch.object(inst.time, 'monotonic', side_effect=lambda: self.clock.now)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_late_truthy_is_rejected_but_old_default_remains_compatible(self):

        def late():
            self.clock.advance(2)
            return True
        with self.assertRaises(TimeoutError):
            inst.wait_for('late', late, timeout=1, deadline=1)
        self.clock.now = 0
        self.assertTrue(inst.wait_for('old-default', late, timeout=1))

    def test_timely_truthy_and_expired_deadline(self):
        self.assertEqual(inst.wait_for('ok', lambda: 42, deadline=1), 42)
        self.clock.now = 1
        with self.assertRaises(TimeoutError):
            inst.remaining(1, 4)

    def test_blocking_observation_uses_remaining_and_rejects_late_result(self):
        journey = object.__new__(inst.AppJourney)
        journey.observer = ROOT / 'inert-observer'
        journey.bundle = ROOT / 'inert.app'

        def read(*args, **kw):
            self.assertEqual(kw['timeout'], 0.4)
            self.clock.advance(0.5)
            return b'{}'
        with patch.object(inst.subprocess, 'check_output', side_effect=read), self.assertRaises(TimeoutError):
            journey.observe(deadline=0.4)

    def test_console_subprocesses_share_budget(self):
        import plistlib
        timeouts = []

        def launch(*args, **kw):
            timeouts.append(kw['timeout'])
            self.clock.advance(0.2)
            return types.SimpleNamespace(returncode=0)

        def ioreg(*args, **kw):
            timeouts.append(kw['timeout'])
            self.clock.advance(0.2)
            return plistlib.dumps([dict(IOConsoleLocked=False)])
        with patch.object(ctrl.os, 'getuid', return_value=501), patch.object(ctrl.os, 'stat', return_value=types.SimpleNamespace(st_uid=501)), patch.object(ctrl.subprocess, 'run', side_effect=launch), patch.object(ctrl.subprocess, 'check_output', side_effect=ioreg):
            facts = ctrl.console_facts(deadline=0.6)
        self.assertFalse(facts['root_locked'])
        self.assertAlmostEqual(timeouts[0], 0.6)
        self.assertAlmostEqual(timeouts[1], 0.4)

    def owner(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        identity = dict(pid=12, bundle='inert', launch_time=1)
        record = dict(app_pid=12, workspace_window_count=1, window_number=3, app_active=True, control_nonce='10000000-0000-0000-0000-000000000001')
        state = dict(apps=[identity], frontmost=identity)
        journey = types.SimpleNamespace(identity=identity, control=Path(temp.name).resolve(), observe=lambda **kw: state, read=lambda **kw: record)
        facts = dict(uid=501, console_uid=501, aqua=True, root_locked=False, cgs_locked=None)
        control = ctrl.AttentionControl(probe=lambda **kw: facts, clock=lambda: 100)
        self.addCleanup(control.close)
        return (journey, control)

    def test_timely_publish_expiry_is_clipped_to_same_deadline(self):
        journey, control = self.owner()
        control.publish(journey, 'bounded', 'click', deadline=0.6)
        value = json.loads((journey.control / 'bounded.json').read_text())
        self.assertEqual(float(value['expires']), 100.6)

    def test_slow_read_or_custody_cannot_publish(self):
        for operation in ('read', 'observe', 'probe'):
            with self.subTest(operation=operation):
                self.clock.now = 0
                journey, control = self.owner()
                owner = control if operation == 'probe' else journey
                prior = getattr(owner, operation)

                def delayed(**kw):
                    self.clock.advance(2)
                    return prior(**kw)
                setattr(owner, operation, delayed)
                with self.assertRaises(TimeoutError):
                    control.publish(journey, 'denied', 'click', deadline=1)
                self.assertFalse((journey.control / 'denied.json').exists())
                self.assertTrue(control.retired)

    def test_delay_immediately_before_atomic_publication_is_denied(self):
        journey, control = self.owner()
        old = control._validate_directory
        calls = []

        def validate():
            old()
            calls.append(1)
            if len(calls) == 3:
                self.clock.advance(2)
        control._validate_directory = validate
        with self.assertRaises(TimeoutError):
            control.publish(journey, 'denied', 'click', deadline=1)
        self.assertFalse((journey.control / 'denied.json').exists())
        self.assertEqual(list(journey.control.iterdir()), [])

    def test_stage_rejects_late_custody_and_keeps_default(self):
        journey = object.__new__(driver.AttentionJourney)
        record = dict(engine_pid=12, app_pid=4, workspace_window_count=1)
        with patch.object(inst.AppJourney, 'stage', return_value=record):

            def late(*args, **kw):
                self.clock.advance(2)
            journey.custody = types.SimpleNamespace(check=late)
            with self.assertRaises(TimeoutError):
                journey.stage('sample', deadline=1)
            journey.custody = types.SimpleNamespace(check=lambda _: None)
            self.assertEqual(journey.stage('old-default'), record)

    def test_command_does_not_accept_late_publication_or_stage(self):
        for boundary in ('publish', 'stage'):
            with self.subTest(boundary=boundary):
                self.clock.now = 0
                command, _ = nested_driver()
                calls = []

                def publish(*args, **kw):
                    self.assertLessEqual(kw['deadline'], 2)
                    calls.append('publish')
                    if boundary == 'publish':
                        self.clock.advance(3)

                def stage(*args, **kw):
                    calls.append('stage')
                    self.clock.advance(3)
                    return {}
                journey = types.SimpleNamespace(custody=types.SimpleNamespace(publish=publish), stage=stage)
                with self.assertRaises(TimeoutError):
                    command(journey, 'click', deadline=20)
                if boundary == 'publish':
                    self.assertEqual(calls, ['publish'])

    def test_ready_acceptance_checks_absolute_deadline_after_truthy_sample(self):
        for delay in (0, 21):
            with self.subTest(delay=delay):
                self.clock.now = 0
                _, ready = nested_driver()
                doc = dict(launch='l', view='v', document='d')

                def stage(label, **kw):
                    self.clock.advance(delay)
                    return dict(stage=label, document_binding=doc, attention=dict(generation=1), same_view=True, same_engine=True, window_visible=True, chat_readiness=dict(ready=True, sample=label, document=doc, generation=1, route=driver.canonical_chat_route('id'), session='id'))
                journey = types.SimpleNamespace(custody=types.SimpleNamespace(publish=lambda *a, **kw: None), stage=stage)
                if delay:
                    with self.assertRaises(TimeoutError):
                        ready(journey, 'id', 20)
                else:
                    self.assertTrue(ready(journey, 'id', 20)['chat_readiness']['ready'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
