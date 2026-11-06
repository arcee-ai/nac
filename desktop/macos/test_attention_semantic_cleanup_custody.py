"""Actual attention website/root boundary with private bytes and inert callbacks."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import patch

import attention_fixture_cleanup as cleanup
from attention_reset_readout import ResetReadout


class AttentionCleanupCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name).resolve()
        self.root = self.parent / 'nac-attention-app-cleanup-control'
        self.root.mkdir(mode=0o700)
        self.owned = ResetReadout(self.root)
        self.addCleanup(self.owned.close)
        home = self.root / 'profile'; home.mkdir(mode=0o700)
        self.input = dict(home=str(home), receipt=dict(store=str(home / 'selected store.db'), identity=dict(track='dev')))
        cleanup.write_input(self.owned, self.input)
        self.original = self.root.with_name('retained-original')
        self.calls = []; self.helpers = []

    def replace(self):
        self.root.rename(self.original)
        self.root.mkdir(mode=0o700)
        (self.root / 'sentinel').write_text('preserve-successor')

    def result(self):
        raw = 'nac-presentation-v1\0' + self.input['home'] + '\0dev\0' + self.input['receipt']['store']
        digest = hashlib.sha256(raw.encode()).hexdigest()
        return dict(root=str(self.root), initialization_ephemeral=True, profile=digest,
                    website_store_removed=str(uuid.UUID(bytes=bytes.fromhex(digest)[:16], version=5)),
                    root_device=self.owned.expected[0], root_inode=self.owned.expected[1],
                    parent_device=self.owned.parent_identity[0], parent_inode=self.owned.parent_identity[1])

    def spawn(self, action=None, result=None, exit_code=0, timeout=False, receipt_error=None):
        test = self
        class Helper:
            pid = 123
            def __init__(self, args, **kwargs):
                self.args = args; self.returncode = None; self.polls = 0; test.helpers.append(self)
                test.assertEqual(args[1:], [str(test.root), str(test.owned.fd), str(test.owned.parent_fd)])
                test.assertEqual(kwargs['pass_fds'], (test.owned.fd, test.owned.parent_fd))
                test.assertEqual(os.fstat(int(args[2])).st_ino, test.owned.expected[1])
                test.calls.append('input-captured')
            def wait(self, **kwargs):
                if self.returncode is not None: return self.returncode
                if timeout and 'timeout' in kwargs: raise subprocess.TimeoutExpired(self.args, 15)
                if action: action()
                if receipt_error: raise receipt_error
                if exit_code == 0:
                    # This fake callback deliberately uses the old pathname,
                    # allowing the controller boundary to detect a successor.
                    fd = os.open(test.root / 'cleanup-result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'w') as output:
                        if isinstance(result, bytes): output.write(result.decode())
                        else: json.dump(test.result() if result is None else result, output)
                self.returncode = exit_code
                return exit_code
            def poll(self):
                self.polls += 1
                if self.returncode is None and self.polls >= 3: self.returncode = exit_code
                return self.returncode
        return patch.object(cleanup.subprocess, 'Popen', Helper)

    def invoke(self):
        return cleanup.cleanup_fixture(self.owned, self.parent / 'AttentionFixtureCleanup', {})

    def retained(self):
        self.assertTrue(self.root.exists())
        self.assertEqual((self.root / 'sentinel').read_text(), 'preserve-successor')
        self.assertTrue(self.original.exists())

    def test_exact_original_generation_happy_cleanup(self):
        (self.root / 'nested').mkdir(mode=0o700)
        (self.root / 'nested/private').write_text('original')
        with self.spawn(): self.invoke()
        self.assertFalse(self.root.exists())
        self.assertEqual(self.calls, ['input-captured'])

    def test_replacement_during_callback_retains_both_generations(self):
        with self.spawn(action=self.replace), self.assertRaisesRegex(AssertionError, 'replaced'): self.invoke()
        self.retained()

    def test_replacement_before_callback_never_launches_helper(self):
        self.replace()
        with self.spawn(), self.assertRaises(AssertionError): self.invoke()
        self.assertFalse(self.helpers); self.retained()

    def test_replaced_parent_is_not_adopted(self):
        # Parent itself is owned by this test, and no outside pathname is used.
        retained = self.parent.with_name(self.parent.name + '-retained')
        self.parent.rename(retained)
        self.addCleanup(lambda: __import__('shutil').rmtree(retained))
        self.parent.mkdir(mode=0o700); self.root.mkdir(mode=0o700)
        (self.root / 'sentinel').write_text('preserve-successor')
        with self.spawn(), self.assertRaises(AssertionError): self.invoke()
        self.assertFalse(self.helpers)
        self.assertEqual((self.root / 'sentinel').read_text(), 'preserve-successor')
        self.assertTrue((retained / self.root.name).exists())

    def test_wrong_generation_receipt_never_removes_root(self):
        result = dict(self.result(), root_inode=self.owned.expected[1] + 1)
        with self.spawn(result=result), self.assertRaisesRegex(AssertionError, 'generation'): self.invoke()
        self.assertTrue(self.root.exists())

    def test_malformed_duplicate_or_boolean_receipt_retains_root(self):
        for payload in (b'{', b'{"root":"x","root":"y"}', b'[]'):
            with self.subTest(payload=payload):
                with self.spawn(result=payload), self.assertRaises((AssertionError, ValueError, TypeError)): self.invoke()
                (self.root / 'cleanup-result.json').unlink()
        result = dict(self.result(), root_device=True)
        with self.spawn(result=result), self.assertRaises(AssertionError): self.invoke()
        self.assertTrue(self.root.exists())

    def test_failed_helper_never_claims_removal(self):
        with self.spawn(exit_code=1), self.assertRaisesRegex(AssertionError, 'helper failed'): self.invoke()
        self.assertTrue(self.root.exists()); self.assertFalse((self.root / 'cleanup-result.json').exists())

    def test_cancelled_controller_retains_late_helper_and_descriptors(self):
        class Late:
            args = []; pid = 99
            def __init__(self): self.polls = 0; self.returncode = None
            def wait(self, **kwargs):
                if 'timeout' in kwargs: raise KeyboardInterrupt('cancelled')
                return 0
            def poll(self):
                self.polls += 1
                self.returncode = 0 if self.polls == 3 else None
                return self.returncode
        child = Late()
        def pause(_):
            self.owned.validate(); self.calls.append('held-through-late-callback')
        with patch.object(cleanup.subprocess, 'Popen', return_value=child), patch.object(cleanup.time, 'sleep', side_effect=pause):
            with self.assertRaises(KeyboardInterrupt): self.invoke()
        self.assertEqual(child.polls, 3); self.assertEqual(len(self.calls), 2)
        self.assertTrue(self.root.exists())

    def test_timeout_remains_failure_after_original_helper_settles(self):
        with self.spawn(timeout=True), patch.object(cleanup.time, 'sleep'), self.assertRaises(subprocess.TimeoutExpired): self.invoke()
        self.assertEqual(self.helpers[0].polls, 3); self.assertTrue(self.root.exists())

    def test_receipt_observer_failure_keeps_original_helper_until_exit(self):
        with self.spawn(), self.assertRaisesRegex(OSError, 'receipt'):
            cleanup.run_helper(self.owned, self.parent / 'helper', {}, lambda _: (_ for _ in ()).throw(OSError('receipt')))
        self.assertIsNotNone(self.helpers[0].returncode); self.assertTrue(self.root.exists())

    def test_read_symlink_mode_and_foreign_uid_fail_closed(self):
        (self.root / 'cleanup-input.json').chmod(0o644)
        with self.spawn(), self.assertRaises(AssertionError): self.invoke()
        self.assertFalse(self.helpers)
        (self.root / 'cleanup-input.json').chmod(0o600)
        with patch('attention_reset_readout.os.getuid', return_value=os.getuid() + 1), self.assertRaises(AssertionError): self.owned.validate()
        (self.root / 'cleanup-input.json').unlink()
        (self.root / 'cleanup-input.json').symlink_to(self.parent / 'not-read')
        with self.spawn(), self.assertRaises(OSError): self.invoke()
        self.assertFalse(self.helpers)

    def test_input_write_failure_closes_the_exact_file_descriptor(self):
        (self.root / 'cleanup-input.json').unlink()
        opened = []; closed = []
        real_open, real_close = os.open, os.close
        def opening(*args, **kwargs):
            fd = real_open(*args, **kwargs); opened.append(fd); return fd
        def closing(fd): closed.append(fd); return real_close(fd)
        with patch.object(cleanup.os, 'open', side_effect=opening), patch.object(cleanup.os, 'close', side_effect=closing), \
             patch.object(cleanup.os, 'fdopen', side_effect=OSError('injected fdopen')):
            with self.assertRaises(OSError): cleanup.write_input(self.owned, self.input)
        self.assertEqual(opened, closed)
        self.owned.validate()

    def test_real_driver_cleanup_blocks_reject_callback_replacement(self):
        import ast
        import attention_app_smoke
        import attention_semantic_app_smoke
        for module in (attention_app_smoke, attention_semantic_app_smoke):
            with self.subTest(driver=module.__name__), tempfile.TemporaryDirectory() as temp:
                parent = Path(temp).resolve(); root = parent / 'nac-attention-app-driver'
                root.mkdir(mode=0o700); owned = ResetReadout(root)
                try:
                    home = root / 'profile'; home.mkdir(mode=0o700)
                    cleanup.write_input(owned, dict(home=str(home), receipt=dict(
                        store=str(home / 'selected store.db'), identity=dict(track='dev'))))
                    tree = ast.parse(Path(module.__file__).read_text())
                    block = next(n for n in ast.walk(tree) if isinstance(n, ast.If)
                        and ast.unparse(n.test) == 'not errors' and 'cleanup_fixture(' in ast.unparse(n))
                    def replaced(*args, **kwargs):
                        root.rename(root.with_name('retained-original')); root.mkdir(mode=0o700)
                        (root / 'sentinel').write_text('preserve-successor')
                        return SimpleNamespace(pid=12,args=args[0],wait=lambda **kw:0,poll=lambda:0)
                    errors = []; evidence = {'passed': True}
                    context = dict(errors=errors,evidence=evidence,owned=owned,environment={},
                        observer=parent/'observer',cleanup_fixture=cleanup.cleanup_fixture,
                        destination=parent,root=root)
                    with patch.object(cleanup.subprocess,'Popen',side_effect=replaced):
                        exec(compile(ast.Module(body=[block],type_ignores=[]),module.__file__,'exec'),context)
                    self.assertTrue(errors); self.assertNotIn('private_root_removed',evidence)
                    self.assertTrue(root.with_name('retained-original').exists())
                    self.assertEqual((root/'sentinel').read_text(),'preserve-successor')
                finally: owned.close()

    def test_real_driver_setup_failures_finalize_root_descriptors(self):
        import attention_app_smoke
        import attention_semantic_app_smoke
        for module in (attention_app_smoke, attention_semantic_app_smoke):
            with self.subTest(driver=module.__name__), tempfile.TemporaryDirectory() as temp:
                base=Path(temp).resolve(); bundle=base/'fixture.app'; resources=bundle/'Contents/Resources'
                resources.mkdir(parents=True); (bundle/'Contents/MacOS').mkdir()
                engine=resources/'nac-web'; native=bundle/'Contents/MacOS/NACPreview'
                engine.write_bytes(b'inert engine'); native.write_bytes(b'inert native')
                digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
                receipt=dict(source_head='a'*40,source_dirty=False,normal_startup=True,attention_smoke_instrumentation=True,
                    engine_identity=dict(source_revision='a'*40),native_sha256=digest(native),engine_sha256=digest(engine),native_source_files={})
                (resources/'build-receipt.json').write_text(json.dumps(receipt))
                owned=[]
                def capture(root):
                    owner=ResetReadout(root); owned.append(owner); return owner
                with patch.object(module,'source_binding',return_value={}), patch.object(module,'console_facts',return_value={}), \
                     patch.object(module,'require_console'), patch.object(module,'ResetReadout',side_effect=capture), \
                     patch.object(module.shutil,'copytree',side_effect=OSError('injected setup')), \
                     patch.object(module.subprocess,'check_output',return_value='a'*40), \
                     patch.object(module.subprocess,'Popen',side_effect=AssertionError('no process')):
                    with self.assertRaisesRegex(OSError,'setup'):
                        module.run_contract(bundle,base/'output',base/'observer','a'*40)
                self.assertEqual(len(owned),1)
                self.assertIsNone(owned[0].fd); self.assertIsNone(owned[0].parent_fd)

    def test_owner_descriptors_close_idempotently(self):
        before = {self.owned.fd, self.owned.parent_fd}
        self.owned.close(); self.owned.close()
        for descriptor in before:
            with self.assertRaises(OSError): os.fstat(descriptor)


if __name__ == '__main__': unittest.main()
