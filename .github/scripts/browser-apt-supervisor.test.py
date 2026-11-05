#!/usr/bin/env python3
"""Unprivileged structural/controller controls; real UID0 control is hosted only."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode=True
HERE=Path(__file__).parent

def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

apt=module('apt','browser-apt.py');supervisor=apt.supervisor


class PrivilegedLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)

    def test_privileged_timeout_requests_root_teardown_never_unprivileged_killpg(self):
        class Child:
            pid=123456;returncode=None
            def poll(self):return None
            def wait(self,timeout):self.returncode=1;return 1
        child=Child()
        with patch.object(apt.supervisor,'process',return_value={'pid':os.getpid(),'start':42,'uid':os.getuid()}),\
             patch.object(apt.subprocess,'Popen',return_value=child)as launch,\
             patch.object(apt,'await_privileged_result',return_value={'cleanup':{'remaining':[]}})as receipt,\
             patch.object(apt.os,'killpg',side_effect=PermissionError('root group'))as forbidden:
            with self.assertRaisesRegex(ValueError,'controller timeout'):
                apt.run(self.root,'privileged',['sudo','apt-get','update'],timeout=.01)
        forbidden.assert_not_called();receipt.assert_called_once()
        args=launch.call_args.args[0];self.assertEqual(args[:3],['sudo','-n','--'])
        self.assertIn('browser-apt-supervisor.py',args[4]);self.assertEqual(args[-2:],['/usr/bin/apt-get','update'])
        control=self.root/'privileged-privileged'
        self.assertEqual((control/'stop').read_text(),args[args.index('--nonce')+1])
        self.assertEqual((control.stat().st_mode&0o777),0o700)
        self.assertIsNotNone(json.loads((self.root/'privileged-command.json').read_text())['error'])

    def test_missing_root_receipt_is_failure_even_if_sudo_wrapper_exited(self):
        with self.assertRaises(FileNotFoundError):apt.privileged_result(self.root,'a'*32)
        (self.root/'result.json').write_text(json.dumps({'schema':1,'nonce':'a'*32,'uid':0,'cleanup':{'remaining':[]}}))
        with self.assertRaisesRegex(ValueError,'actual root receipt'):apt.privileged_result(self.root,'a'*32)

    def test_pid_identity_reuse_does_not_match_owned_process(self):
        with patch.object(supervisor,'process',return_value={'pid':123,'start':43}):
            self.assertIsNone(supervisor.same({'pid':123,'start':42}))

    def test_nested_or_foreign_replacement_never_establishes_ownership(self):
        parent=os.getpid()
        def direct(pid):return {11}if pid==parent else {12}
        def process(pid):return {'pid':pid,'start':pid,'ppid':parent if pid==11 else 999}
        with patch.object(supervisor,'children',side_effect=direct)as listing,\
             patch.object(supervisor,'process',side_effect=process)as inspected:
            self.assertEqual(set(supervisor.owned()),{11})
            listing.assert_called_once_with(parent)
            self.assertEqual([call.args[0]for call in inspected.call_args_list],[11])
        with patch.object(supervisor,'children',return_value={12}),patch.object(supervisor,'process',side_effect=process):
            self.assertEqual(supervisor.owned(),{})

    def test_adopted_descendant_is_eligible_only_after_actual_direct_parent_edge(self):
        parent=os.getpid()
        with patch.object(supervisor,'children',side_effect=[{11},{12}]),\
             patch.object(supervisor,'process',side_effect=lambda p:{'pid':p,'start':p,'ppid':parent}):
            self.assertEqual(set(supervisor.owned()),{11})
            self.assertEqual(set(supervisor.owned()),{12})

    def test_fresh_control_and_stop_refuse_links_foreign_nonce_and_reuse(self):
        control=self.root/'control';control.mkdir(mode=0o700)
        fd=supervisor.control_fd(control,os.getuid())
        try:
            apt.request_stop(control,'a'*32)
            self.assertTrue(supervisor.requested(fd,'a'*32,os.getuid()))
            with self.assertRaisesRegex(ValueError,'foreign stop'):supervisor.requested(fd,'b'*32,os.getuid())
            (control/'stop').unlink();(control/'stop').symlink_to(self.root/'missing')
            with self.assertRaises(OSError):supervisor.requested(fd,'a'*32,os.getuid())
        finally:os.close(fd)
        (control/'stop').unlink();(control/'foreign').write_text('keep')
        with self.assertRaisesRegex(ValueError,'must be fresh'):supervisor.control_fd(control,os.getuid())
        link=self.root/'link';link.symlink_to(control)
        with self.assertRaises(OSError):supervisor.control_fd(link,os.getuid())

    def test_complete_receipt_is_atomic_and_existing_link_is_preserved(self):
        fd=os.open(self.root,os.O_RDONLY)
        try:
            supervisor.publish(fd,'result.json',{'schema':1,'nonce':'a'*32})
            self.assertEqual(json.loads((self.root/'result.json').read_text())['schema'],1)
            self.assertFalse((self.root/'result.json.tmp').exists())
            (self.root/'result.json').unlink();(self.root/'result.json').symlink_to(self.root/'missing')
            with self.assertRaisesRegex(ValueError,'already exists'):supervisor.publish(fd,'result.json',{})
            self.assertTrue((self.root/'result.json').is_symlink())
        finally:os.close(fd)

    def test_local_nonroot_cannot_launch_the_root_supervisor(self):
        args=[sys.executable,str(HERE/'browser-apt-supervisor.py'),'--control',str(self.root),
            '--nonce','a'*32,'--caller',str(os.getpid()),'--start','42','--timeout','1',
            '--cwd',str(self.root),'--',sys.executable,'-c','raise SystemExit(99)']
        result=subprocess.run(args,capture_output=True,timeout=5)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(b'requires actual sudo root',result.stderr)
        self.assertFalse((self.root/'ready.json').exists())


if __name__=='__main__':unittest.main()
