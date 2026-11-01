"""Pure proposal controls. Importing never opens a socket or executes a child."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import contract as c
spec = importlib.util.spec_from_file_location('custody_fixture', Path(__file__).with_name('custody_check.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def audit(event, args):
    if (event.startswith(('subprocess.', 'ctypes.', 'socket.')) or
            event in ('os.kill', 'os.killpg', 'os.fork') or
            event == 'open' and str(args[0]).startswith('/proc/')):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')


sys.addaudithook(audit)


class ProposalControls(unittest.TestCase):
    def test_custody_selector_requires_explicit_expected_mode_ordinary_runner_still_rejects(self):
        control = 'a'*40
        args = (control, 'workflow_dispatch', c.BRANCH, c.CUSTODY_MODE, c.HEAD, c.TREE, c.BASELINE)
        with self.assertRaises(RuntimeError):
            c.validate_request(*args)  # run.py's unchanged default is full evidence only.
        c.validate_request(*args, expected_mode=c.CUSTODY_MODE)
        event = {'inputs': {'heartbeat_evidence': c.CUSTODY_MODE, 'heartbeat_control_sha': control}}
        with self.assertRaises(RuntimeError):
            c.validate_event(event, c.CUSTODY_MODE, control)
        c.validate_event(event, c.CUSTODY_MODE, control, expected_mode=c.CUSTODY_MODE)
        for mode in ('invalid', 'none', ''):
            with self.assertRaises(RuntimeError):
                c.validate_request(*args, expected_mode=mode)

    def test_admitted_work_and_deaths_do_not_qualify_a_forced_or_unresolved_check(self):
        for case in ('controller', 'wrapper'):
            terminal = None if case == 'controller' else {'state': 'FAIL', 'artifacts_stable': True,
                'namespace_retirement': {'state': 'RETIRED', 'pid1_death_verified': True, 'first_error': None}}
            args = dict(case=case, admitted=True, controller_dead=True, pid1_dead=True,
                wrapper_dead=True, forced=False, controller_exit=-9 if case == 'controller' else 0, terminal=terminal, manifest=case == 'wrapper')
            self.assertEqual(fixture.classify(**args), 'PASS_REAL_CUSTODY_ONLY')
            for key in ('admitted', 'controller_dead', 'pid1_dead', 'wrapper_dead', 'forced'):
                changed = {**args, key: key == 'forced'}
                self.assertNotEqual(fixture.classify(**changed), 'PASS_REAL_CUSTODY_ONLY')
            self.assertEqual(fixture.classify(**{**args, 'controller_exit': 91}), 'FAIL')
            if case == 'wrapper':
                bad = {**terminal, 'namespace_retirement': {**terminal['namespace_retirement'],
                                                          'first_error': 'PID1_OUTLIVED_WRAPPER'}}
                self.assertEqual(fixture.classify(**{**args, 'terminal': bad}), 'FAIL')
            else:
                self.assertEqual(fixture.classify(**{**args, 'manifest': True}), 'FAIL')

    def test_actual_driver_cannot_signal_unverified_fd_or_claim_unobserved_retirement(self):
        for case, forged in [('controller', False), ('wrapper', False), ('controller', True)]:
            with self.subTest(case=case, forged=forged), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)/'case'
                state = {'dead': False, 'code': None}
                child, driver, peer, kernel = Mock(pid=123), Mock(), Mock(), Mock()
                child.poll.side_effect = lambda: state['code']

                def finish(timeout):
                    state.update(dead=True, code=state['code'] if state['code'] is not None else 0)
                    if case == 'wrapper' and not forged:
                        c.write_json(output/'terminal.json', {'state': 'FAIL', 'artifacts_stable': True,
                            'namespace_retirement': {'state': 'RETIRED', 'pid1_death_verified': True, 'first_error': None}})
                        c.write_json(output/'artifact-manifest.json', {'files': []})
                    return 0

                child.wait.side_effect = finish
                child.kill.side_effect = lambda: state.update(dead=True, code=-9)
                kernel.ready.side_effect = lambda *a: state['dead']
                kernel.pid.side_effect = lambda fd: 999 if forged else (301 if fd == 40 else 200)

                def packet(channel):
                    context = json.loads((output/'context.json').read_text())
                    if not getattr(packet, 'sent', False):
                        packet.sent = True
                        return {'kind': 'PID1', 'controller': 123, 'nonce': context['lifeline_nonce'],
                                'proof': {'peer_host_pid': 301}, 'admitted': {
                                    'lifeline': {'state': 'VERIFIED_POST_DROP'}}}, 40
                    return {'kind': 'wrapper', 'pid': 200}, 50

                actual_stat = os.stat

                def stat(path, *args, **kwargs):
                    return Mock(st_ino=10) if str(path).startswith('/proc/self/ns/') else actual_stat(path, *args, **kwargs)

                with patch.dict(os.environ, {'EXPECTED_CONTROL': 'a'*40}), \
                     patch.object(fixture.os, 'stat', side_effect=stat), \
                     patch.object(fixture.os, 'close') as close, \
                     patch.object(fixture.socket, 'socketpair', return_value=(driver, peer)), \
                     patch.object(fixture.subprocess, 'Popen', return_value=child), \
                     patch.object(fixture, 'Kernel', return_value=kernel), \
                     patch.object(fixture, 'receive_fd', side_effect=packet):
                    result = fixture.one_case(case, output)
                self.assertEqual(result['state'], 'UNRESOLVED' if forged else 'PASS_REAL_CUSTODY_ONLY')
                kernel.kill.assert_not_called()  # Forged descriptor was closed, never signaled.
                if forged:
                    close.assert_called_once_with(40)
                    self.assertFalse((output/'artifact-manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
