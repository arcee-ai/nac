"""Owned temporary files/fake clocks only; no actor, build, process or input."""
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import ci_paths
import ci_xctest
from ci_paths_budget import BudgetExpired, active, using
from test_ci_paths_budget import Clock


class RelocationJournalTests(unittest.TestCase):
    def exercise(self, mode, primary=None):
        with tempfile.TemporaryDirectory(prefix='nac-journal-inert-') as temporary:
            root=Path(temporary).resolve();raw=root/'raw';raw.mkdir()
            clock=Clock();budget=clock.budget()
            if primary is None:primary=RuntimeError('original inert body error')
            locations=[];writes=[];create=tempfile.mkdtemp;write=Path.write_text
            def owned(**kwargs):
                path=create(dir=root,**kwargs);locations.append(Path(path).resolve());return path
            def writing(path,*args,**kwargs):
                if path.name=='xctest-relocation.json':writes.append(clock.mono())
                return write(path,*args,**kwargs)
            parent=budget.retention.capped(110) if mode=='short-parent' else budget.work
            caught=None
            try:
                with using(parent),patch('ci_xctest.tempfile.mkdtemp',side_effect=owned),patch.object(Path,'write_text',writing):
                    with ci_xctest.relocation_directory(raw) as lease:
                        initial=json.loads((raw/'xctest-relocation.json').read_text())
                        self.assertEqual(initial,dict(path=str(lease['path']),bundle_retained_for_unresolved_cleanup=True))
                        lease['safe_to_remove']=False
                        if mode=='work-latch':budget.fail('work: original inert failure')
                        if mode=='retention-latch':budget.fail('retention: original inert failure')
                        if mode in ('expiry-primary','expiry-normal'):clock.to(budget.retention.deadline)
                        if mode=='short-parent':clock.to(110)
                        if mode!='expiry-normal':raise primary
            except BaseException as error:caught=error
            receipt=json.loads((raw/'xctest-relocation.json').read_text())
            self.assertTrue(locations[0].exists())
            self.assertTrue(receipt['bundle_retained_for_unresolved_cleanup'])
            cutoff=110 if mode=='short-parent' else budget.retention.deadline
            self.assertTrue(all(stamp<cutoff for stamp in writes),'No write starts at/after original cutoff')
            self.assertEqual(budget.retention.deadline,1900)
            if mode=='expiry-normal':self.assertIsInstance(caught,BudgetExpired)
            else:self.assertIs(caught,primary)
            if mode in ('expiry-primary','short-parent'):
                self.assertEqual(len(writes),1)
                self.assertTrue(budget.failed)
                notes='\n'.join(primary.__notes__)
                self.assertLess(len(notes),256)
                self.assertIn('BudgetExpired',notes)
            self.assertIsNone(active())

    def test_first_journal_and_primary_survive_original_retention_cutoff(self):self.exercise('expiry-primary')
    def test_normal_body_expiry_remains_failure(self):self.exercise('expiry-normal')
    def test_shorter_parent_cutoff_is_not_renewed(self):self.exercise('short-parent')
    def test_latch_alone_before_cutoff_keeps_independent_retention(self):
        for mode in ('in-bound','work-latch','retention-latch'):
            with self.subTest(mode=mode):self.exercise(mode)

    def test_secondary_expiry_note_never_formats_private_body_error(self):
        class PrivateError(Exception):
            def __str__(self):raise AssertionError('Do not format private body error')
        self.exercise('expiry-primary',PrivateError())

    def test_expired_initial_allowance_never_creates_or_yields_a_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw=Path(temporary).resolve();clock=Clock();budget=clock.budget()
            with patch('ci_xctest.tempfile.mkdtemp') as create:
                with self.assertRaises(BudgetExpired):
                    with using(budget.work):
                        clock.to(budget.work.deadline)
                        with ci_xctest.relocation_directory(raw):self.fail('Expired work cannot yield')
                create.assert_not_called()
            self.assertFalse((raw/'xctest-relocation.json').exists())
            self.assertTrue(budget.failed)
            self.assertIsNone(active())

    def test_failed_cleanup_never_changes_conservative_journal_into_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();raw=root/'raw';raw.mkdir()
            clock=Clock();budget=clock.budget();create=tempfile.mkdtemp
            primary=OSError('inert owned directory cleanup failure')
            def owned(**kwargs):return create(dir=root,**kwargs)
            with using(budget.work),patch('ci_xctest.tempfile.mkdtemp',side_effect=owned), \
                    patch('ci_xctest.shutil.rmtree',side_effect=primary):
                with self.assertRaises(OSError) as caught:
                    with ci_xctest.relocation_directory(raw):pass
            self.assertIs(caught.exception,primary)
            receipt=json.loads((raw/'xctest-relocation.json').read_text())
            self.assertTrue(receipt['bundle_retained_for_unresolved_cleanup'])
            self.assertTrue(Path(receipt['path']).exists())

    def test_pre_yield_journal_failure_never_hands_root_to_caller(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();raw=root/'raw';raw.mkdir()
            clock=Clock();budget=clock.budget();primary=OSError('inert unavailable journal')
            locations=[];create=tempfile.mkdtemp;entered=[]
            def owned(**kwargs):
                path=create(dir=root,**kwargs);locations.append(Path(path));return path
            with using(budget.work),patch('ci_xctest.tempfile.mkdtemp',side_effect=owned), \
                    patch.object(Path,'write_text',side_effect=primary) as writer:
                with self.assertRaises(OSError) as caught:
                    with ci_xctest.relocation_directory(raw):entered.append(True)
            self.assertIs(caught.exception,primary)
            self.assertFalse(entered)
            self.assertEqual(writer.call_count,1)
            self.assertFalse(locations[0].exists(),'Empty unhanded root settled within original allowance')
            self.assertFalse((raw/'xctest-relocation.json').exists())

    def test_early_actual_path_verify_build_failure_retains_journal_before_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();raw=root/'raw';raw.mkdir();app=root/'Fixture.app';app.mkdir()
            (app/'inert.txt').write_text('No executable or native actor')
            clock=Clock();budget=clock.budget();primary=RuntimeError('original pre-configuration verify_build error')
            locations=[];create=tempfile.mkdtemp
            def owned(**kwargs):
                path=create(dir=root,**kwargs);locations.append(Path(path).resolve());return path
            def verify(*args):clock.to(budget.retention.deadline);raise primary
            def forbidden(*args,**kwargs):self.fail('No build/input/command/settlement actor may run')
            with self.assertRaises(RuntimeError) as caught:
                with using(budget.work),patch('ci_xctest.tempfile.mkdtemp',side_effect=owned), \
                        patch('ci_paths.require_checkout'),patch('ci_paths.verify_build',side_effect=verify):
                    ci_paths.run_case(raw,root,app,{},'a'*40,'fresh-journal-case',
                                      forbidden,forbidden,forbidden,budget.work.deadline,budget=budget)
            self.assertIs(caught.exception,primary)
            folder=raw/'fresh-journal-case'
            self.assertFalse((folder/'configuration.json').exists())
            receipt=json.loads((folder/'xctest-relocation.json').read_text())
            self.assertEqual(receipt['path'],str(locations[0]))
            self.assertTrue(receipt['bundle_retained_for_unresolved_cleanup'])
            self.assertTrue(locations[0].exists())
            self.assertTrue(budget.failed)
            self.assertIsNone(active())

    def test_cleanup_crossing_cutoff_cannot_publish_positive_final_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            raw=Path(temporary).resolve()
            clock=Clock();budget=clock.budget();remove=ci_xctest.shutil.rmtree;writes=[];write=Path.write_text
            def removing(path):
                remove(path);clock.to(budget.retention.deadline)
            def writing(path,*args,**kwargs):
                writes.append(clock.mono());return write(path,*args,**kwargs)
            with self.assertRaises(BudgetExpired):
                with using(budget.work),patch('ci_xctest.shutil.rmtree',side_effect=removing),patch.object(Path,'write_text',writing):
                    with ci_xctest.relocation_directory(raw):pass
            self.assertEqual(writes,[100.])
            self.assertTrue(json.loads((raw/'xctest-relocation.json').read_text())['bundle_retained_for_unresolved_cleanup'])

    def test_final_update_postcheck_expiry_preserves_primary_or_fails_normal_body(self):
        for body_error in (False,True):
            with self.subTest(body_error=body_error),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary).resolve();raw=root/'raw';raw.mkdir()
                clock=Clock();budget=clock.budget();primary=RuntimeError('original postcheck body error')
                create=tempfile.mkdtemp;write=Path.write_text;writes=[]
                def owned(**kwargs):return create(dir=root,**kwargs)
                def writing(path,*args,**kwargs):
                    writes.append(clock.mono())
                    result=write(path,*args,**kwargs)
                    if len(writes)==2:clock.to(budget.retention.deadline)
                    return result
                caught=None
                try:
                    with using(budget.work),patch('ci_xctest.tempfile.mkdtemp',side_effect=owned),patch.object(Path,'write_text',writing):
                        with ci_xctest.relocation_directory(raw) as lease:
                            lease['safe_to_remove']=False
                            if body_error:raise primary
                except BaseException as error:caught=error
                if body_error:
                    self.assertIs(caught,primary)
                    self.assertIn('BudgetExpired','\n'.join(primary.__notes__))
                else:self.assertIsInstance(caught,BudgetExpired)
                self.assertEqual(writes,[100.,100.])
                self.assertTrue(budget.failed)
                receipt=json.loads((raw/'xctest-relocation.json').read_text())
                self.assertTrue(receipt['bundle_retained_for_unresolved_cleanup'])
                self.assertTrue(Path(receipt['path']).exists())
                self.assertIsNone(active())


if __name__=='__main__':unittest.main()
