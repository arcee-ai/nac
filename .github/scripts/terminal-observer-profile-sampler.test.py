#!/usr/bin/env python3
"""Owned temporary metadata fixtures only; never Cargo, browser, APT or executable."""
import ast
import hashlib
import importlib.util
import itertools
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('profile_sampler',Path(__file__).with_name('terminal-observer-profile.py'))
profile=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(profile)
STRICT_PINS={'regular': 'a37cafce1fe4352d66f89ef4ff808a935aca0476c2c2a256ebb69a4436d02fac', 'digest': 'f08afa70fe5eb7bb33f8842d69a534d18cca68f1853c007d56e811edf4feef95', 'expected_identity': '7b6bc17599bd61f3226d2284de2d0bc4859eca35a072a6383ad3ebbe9f44e499', 'verify_identities': '2d613388814df49a8cd1bf2f70c3b1d283f127795d5ec675f72c8121b797879f', 'compiler_identity': 'c3ed2ceba0fcba1b0f673f2a69fb36470b5836f6fb2e25cbb7a264532e0dea18', 'size': 'cdec575a30ea507d8add594542fe6602fdcf6678262b28f9b50cf7c8882b8202', 'dependency_inventory': '0e029398c0cc77f1345feb620e9f1474d0cc4da346efb5087cababaf96d76141'}


class SamplerControls(unittest.TestCase):
    def test_original_strict_reader_bytes_and_resource_fences_preserved(self):
        source=Path(profile.__file__).read_text();lines=source.splitlines(keepends=True)
        actual={node.name:hashlib.sha256(''.join(lines[node.lineno-1:node.end_lineno]).encode()).hexdigest()
                for node in ast.parse(source).body if isinstance(node,ast.FunctionDef)and node.name in STRICT_PINS}
        self.assertEqual(actual,STRICT_PINS)
        self.assertIn("require(compiler['complete']and type(compiler['logical_bytes'])is int",source)
        self.assertIn("sample['target_bytes']<=12*GIB",source)
        self.assertIn("shutil.disk_usage(self.home).free>=13*GIB",source)
        self.assertIn("require(size(ROOT/'target')<=12*GIB,'12GiB final compiler budget')",source)

    def test_real_unlink_reproduces_original_RED_then_rescans_complete_GREEN(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);target=root/'target';target.mkdir();keep=target/'keep';keep.write_bytes(b'kept-data')
            gone=target/'gone.o';gone.write_bytes(b'obj');old_lstat=Path.lstat
            def disappear(path,*args,**kwargs):
                if path==gone:gone.unlink()
                return old_lstat(path,*args,**kwargs)
            with patch.object(Path,'lstat',disappear),self.assertRaises(FileNotFoundError):profile.size(target)
            gone.write_bytes(b'obj');original=profile.os.stat;removed=False
            def mutate(name,*args,**kwargs):
                nonlocal removed
                if name=='gone.o'and kwargs.get('dir_fd')is not None and not removed:
                    removed=True;os.unlink(name,dir_fd=kwargs['dir_fd'])
                return original(name,*args,**kwargs)
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'stat',side_effect=mutate):
                inventory=profile.CompilerInventory();value=inventory.sample(active=True)
                final=inventory.sample()
            self.assertTrue(value['complete']);self.assertEqual(value['passes'],2)
            self.assertEqual(value['disappeared'],{'stat':1,'open_directory':0,'directory_recheck':0})
            self.assertEqual(value['logical_bytes'],len(b'kept-data'));self.assertFalse(value['atomic_or_peak'])
            self.assertTrue(final['complete']);self.assertEqual(final['disappeared']['stat'],0)
            print(json.dumps({'owned_temp':True,'original_strict_size':'FileNotFoundError RED','active_rescan':value,'settled_strict':final},sort_keys=True))

    def test_real_directory_disappearance_requires_rescan_and_strict_rejects(self):
        for active in (True,False):
            with self.subTest(active=active),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);sub=root/'target/deps';sub.mkdir(parents=True);original=profile.os.open;removed=False
                def mutate(name,*args,**kwargs):
                    nonlocal removed
                    if name=='deps'and not removed:removed=True;sub.rmdir()
                    return original(name,*args,**kwargs)
                with patch.object(profile,'ROOT',root),patch.object(profile.os,'open',side_effect=mutate):
                    inventory=profile.CompilerInventory()
                    if not active:
                        with self.assertRaises(FileNotFoundError):inventory.sample()
                        self.assertFalse(inventory.last['complete']);self.assertIsNone(inventory.last['logical_bytes'])
                    else:
                        value=inventory.sample(active=True);self.assertEqual(value['passes'],2)
                        self.assertEqual(value['disappeared']['open_directory'],1);self.assertTrue(value['complete'])

    def test_directory_recheck_disappearance_and_initial_root_absence_do_not_admit_partial(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);sub=root/'target/deps';sub.mkdir(parents=True);original=profile.os.stat;seen=0
            def remove_on_recheck(name,*args,**kwargs):
                nonlocal seen
                if name=='deps':
                    seen+=1
                    if seen==2:sub.rmdir()
                return original(name,*args,**kwargs)
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'stat',side_effect=remove_on_recheck):
                value=profile.CompilerInventory().sample(active=True)
            self.assertEqual(value['passes'],2);self.assertEqual(value['disappeared']['directory_recheck'],1)
            self.assertTrue(value['complete']);self.assertEqual(value['logical_bytes'],0)
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);original=profile.os.stat;created=False
            def initial_missing(name,*args,**kwargs):
                nonlocal created
                try:return original(name,*args,**kwargs)
                except FileNotFoundError:
                    if name=='target'and not created:created=True;(root/'target').mkdir()
                    raise
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'stat',side_effect=initial_missing):
                value=profile.CompilerInventory().sample(active=True)
            self.assertEqual(value['passes'],2);self.assertEqual(value['root_absent_passes'],1)
            self.assertTrue(value['complete']);self.assertEqual(value['logical_bytes'],0)
        with tempfile.TemporaryDirectory()as directory:
            inventory=profile.CompilerInventory();clock=iter(itertools.count())
            with patch.object(profile,'ROOT',Path(directory)),patch.object(profile.time,'monotonic',side_effect=lambda:next(clock)):
                with self.assertRaises(profile.CompilerAccountingUnknown):inventory.sample(active=True)
            self.assertFalse(inventory.last['complete']);self.assertIsNone(inventory.last['logical_bytes'])

    def test_unstable_tree_exhaustion_is_unknown_not_partial_or_last_known_cap(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);target=root/'target';target.mkdir();file=target/'gone.o';file.write_bytes(b'object')
            original=profile.os.stat
            with patch.object(profile,'ROOT',root):
                inventory=profile.CompilerInventory();self.assertEqual(inventory.sample()['logical_bytes'],6)
                def churn(name,*args,**kwargs):
                    if name=='gone.o':os.unlink(name,dir_fd=kwargs['dir_fd'])
                    elif name=='target'and not file.exists():file.write_bytes(b'object')
                    return original(name,*args,**kwargs)
                clock=iter(itertools.count());tick=lambda:next(clock)/100
                with patch.object(profile.os,'stat',side_effect=churn),patch.object(profile.time,'monotonic',side_effect=tick):
                    with self.assertRaises(profile.CompilerAccountingUnknown):inventory.sample(active=True)
                self.assertFalse(inventory.last['complete']);self.assertIsNone(inventory.last['logical_bytes'])
                self.assertEqual(inventory.last['last_known_complete_logical_bytes'],6)
                self.assertGreater(inventory.last['disappeared']['stat'],1)
                print(json.dumps({'typed_unknown':inventory.last,'no_partial_cap_PASS':True},sort_keys=True))

    def test_shared_entry_budget_does_not_reset_for_rescan(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);target=root/'target';target.mkdir();(target/'keep').write_bytes(b'x')
            original=profile.os.stat;scans=0
            class Entries:
                def __init__(self):self.items=iter(itertools.chain(itertools.repeat(types.SimpleNamespace(name='keep'),100001),[types.SimpleNamespace(name='gone.o')]))
                def __next__(self):return next(self.items)
                def close(self):pass
            def scan(fd):
                nonlocal scans
                scans+=1;return Entries()
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'scandir',side_effect=scan),patch.object(profile.time,'monotonic',return_value=0):
                inventory=profile.CompilerInventory()
                with self.assertRaises(profile.CompilerAccountingUnknown):inventory.sample(active=True)
            self.assertEqual(scans,2);self.assertEqual(inventory.last['entries'],200001)
            self.assertIsNone(inventory.last['logical_bytes']);self.assertFalse(inventory.last['complete'])

    def test_no_follow_special_files_and_outside_sentinel(self):
        for kind in ('file-link','directory-link','root-link','fifo'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);target=root/'target';target.mkdir();outside=root/'outside';outside.mkdir()
                sentinel=outside/'sentinel';sentinel.write_bytes(b'unchanged');os.mkfifo(outside/'never-enter')
                before=(sentinel.read_bytes(),sentinel.stat().st_mtime_ns)
                if kind=='file-link':(target/'link').symlink_to(sentinel)
                elif kind=='directory-link':(target/'link').symlink_to(outside,target_is_directory=True)
                elif kind=='root-link':target.rmdir();target.symlink_to(outside,target_is_directory=True)
                else:os.mkfifo(target/'fifo')
                with patch.object(profile,'ROOT',root),patch.object(profile.os,'read',side_effect=AssertionError('metadata only')),patch.object(profile.os,'scandir',wraps=profile.os.scandir)as scanned:
                    with self.assertRaises((ValueError,OSError)):profile.CompilerInventory().sample(active=True)
                    self.assertEqual(scanned.call_count,0 if kind=='root-link'else 1) # Never scan outside.
                self.assertEqual((sentinel.read_bytes(),sentinel.stat().st_mtime_ns),before)
                self.assertTrue((outside/'never-enter').exists())

    def test_root_replacement_and_missing_bound_root_fail_closed(self):
        for during in (False,True):
            with self.subTest(during=during),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);target=root/'target';target.mkdir();(target/'keep').write_bytes(b'x')
                with patch.object(profile,'ROOT',root):
                    inventory=profile.CompilerInventory()
                    if not during:
                        inventory.sample();target.rename(root/'old-target')
                        with self.assertRaisesRegex(ValueError,'root disappeared'):inventory.sample(active=True)
                        target.mkdir()
                        with self.assertRaisesRegex(ValueError,'root identity changed'):inventory.sample(active=True)
                    else:
                        original=profile.os.scandir;changed=False
                        def replace(fd):
                            nonlocal changed
                            if not changed:changed=True;target.rename(root/'old-target');target.mkdir()
                            return original(fd)
                        with patch.object(profile.os,'scandir',side_effect=replace):
                            with self.assertRaisesRegex(ValueError,'directory identity changed'):inventory.sample(active=True)

    def test_foreign_metadata_permission_and_identity_errors_are_not_soft(self):
        for kind in ('uid','dev','permission','inode'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);target=root/'target';target.mkdir();file=target/'entry';file.write_bytes(b'x')
                original=profile.os.stat
                def foreign(name,*args,**kwargs):
                    value=original(name,*args,**kwargs)
                    if name=='entry':
                        if kind=='permission':raise PermissionError('controlled denied stat')
                        attrs={key:getattr(value,key)for key in ('st_uid','st_dev','st_ino','st_mode','st_size')}
                        attrs['st_uid'if kind=='uid'else 'st_dev']+=1
                        return types.SimpleNamespace(**attrs)
                    return value
                with patch.object(profile,'ROOT',root):
                    inventory=profile.CompilerInventory()
                    if kind=='inode':
                        # A directory replacement between nofollow stat/open is never an ENOENT allowance.
                        file.unlink();file.mkdir();opened=profile.os.open;changed=False
                        def swap(name,*args,**kwargs):
                            nonlocal changed
                            if name=='entry'and not changed:changed=True;file.rename(target/'old');file.mkdir()
                            return opened(name,*args,**kwargs)
                        with patch.object(profile.os,'open',side_effect=swap),self.assertRaisesRegex(ValueError,'changed before open'):inventory.sample(active=True)
                    else:
                        with patch.object(profile.os,'stat',side_effect=foreign),self.assertRaises((ValueError,PermissionError)):inventory.sample(active=True)
                    self.assertFalse(inventory.last['complete']);self.assertIsNone(inventory.last['logical_bytes'])

    def test_sparse_logical_cap_and_cold_missing_root_are_explicit(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory)
            with patch.object(profile,'ROOT',root):
                inventory=profile.CompilerInventory();cold=inventory.sample(cold=True)
                self.assertTrue(cold['complete']);self.assertTrue(cold['initially_absent']);self.assertEqual(cold['logical_bytes'],0)
                with self.assertRaisesRegex(ValueError,'missing after settlement'):inventory.sample()
                (root/'target').mkdir()
                with(root/'target/sparse').open('wb')as file:file.truncate(12*profile.GIB+1)
                with self.assertRaisesRegex(ValueError,'12GiB'):inventory.sample(active=True)
                self.assertFalse(inventory.last['complete']);self.assertIsNone(inventory.last['logical_bytes'])

    def test_final_strict_inventory_follows_settlement_and_rejection_is_retained(self):
        for reject in (False,True):
            with self.subTest(reject=reject),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);(root/'target').mkdir();home=root/'home';home.mkdir();trace=[]
                obj=object.__new__(profile.Controller);obj.home=home;obj.raw=home/'raw';obj.raw.mkdir();obj.evidence=home/'evidence';obj.evidence.mkdir()
                obj.deadline=10**12;obj.stopped=False;obj.commands=[];obj.compiler_inventory=profile.CompilerInventory()
                def settle(child):trace.append('settled');return {'remaining':[],'signals':[],'reaped':[]}
                obj.supervisor=types.SimpleNamespace(process=lambda _:None,settle=settle)
                child=types.SimpleNamespace(pid=123,returncode=0,poll=lambda:0)
                sample=obj.compiler_inventory.sample
                def final(*args,**kwargs):
                    self.assertEqual(trace,['settled']);self.assertEqual(kwargs,{})
                    trace.append('strict-final')
                    if reject:raise FileNotFoundError('settled inventory must not disappear')
                    return sample(*args,**kwargs)
                with patch.object(profile,'ROOT',root),patch.object(profile.subprocess,'Popen',return_value=child),patch.object(profile.shutil,'disk_usage',return_value=types.SimpleNamespace(free=20*profile.GIB)),patch.object(obj.compiler_inventory,'sample',side_effect=final):
                    if reject:
                        with self.assertRaises(FileNotFoundError):obj.run('build',['FAKE-NOT-EXECUTED'],720)
                    else:obj.run('build',['FAKE-NOT-EXECUTED'],720)
                receipt=json.loads((obj.evidence/'build.json').read_text());self.assertEqual(trace,['settled','strict-final'])
                self.assertEqual(receipt['cleanup']['remaining'],[])
                self.assertEqual(receipt['compiler_final_inventory']is None,reject)
                self.assertEqual(receipt['compiler_final_error']is not None,reject)


    def test_failed_active_observation_is_not_overwritten_by_complete_settled_final(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);(root/'target').mkdir();home=root/'home';home.mkdir()
            obj=object.__new__(profile.Controller);obj.home=home;obj.raw=home/'raw';obj.raw.mkdir();obj.evidence=home/'evidence';obj.evidence.mkdir()
            obj.deadline=10**12;obj.stopped=False;obj.commands=[];obj.compiler_inventory=profile.CompilerInventory()
            obj.supervisor=types.SimpleNamespace(process=lambda _:None,settle=lambda _:{'remaining':[],'signals':[],'reaped':[]})
            child=types.SimpleNamespace(pid=123,returncode=-15,poll=lambda:None)
            incomplete={'complete':False,'logical_bytes':None,'disappeared':{'stat':4}}
            complete={'complete':True,'logical_bytes':0,'disappeared':{'stat':0}}
            def sample(*,active=False,cold=False):
                obj.compiler_inventory.last=incomplete if active else complete
                if active:raise profile.CompilerAccountingUnknown('controlled incomplete inventory')
                return complete
            with patch.object(profile,'ROOT',root),patch.object(profile.subprocess,'Popen',return_value=child),patch.object(profile.shutil,'disk_usage',return_value=types.SimpleNamespace(free=20*profile.GIB)),patch.object(obj.compiler_inventory,'sample',side_effect=sample):
                with self.assertRaises(profile.CompilerAccountingUnknown):obj.run('build',['FAKE-NOT-EXECUTED'],720)
            receipt=json.loads((obj.evidence/'build.json').read_text())
            self.assertEqual(receipt['compiler_last_inventory'],incomplete)
            self.assertEqual(receipt['compiler_final_inventory'],complete)
            self.assertEqual(receipt['compiler_final_observation'],complete)
            self.assertTrue(receipt['error'].startswith('CompilerAccountingUnknown:'))
            self.assertEqual(receipt['samples'],[]) # Incomplete value never enters cap-accepting samples.


if __name__=='__main__':unittest.main()
