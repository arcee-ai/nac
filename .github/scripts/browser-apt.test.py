#!/usr/bin/env python3
"""Real CLI archive/compatibility controls and owned-root filesystem negatives."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode=True
HERE=Path(__file__).parent

def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

apt=module('apt','browser-apt.py');fixture=module('fixture','apt-archive-store.test.py')
SOURCE=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()


class RelayBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.state=self.root/'state';self.state.mkdir(mode=0o700)
        self.raw=fixture.deb();self.input=self.root/'fixture.deb';self.input.write_bytes(self.raw)
        self.plan={'schema':1,'repository':'arcee-ai/nac','platform':apt.PLATFORM,'packages':[
            {'Package':'fixture-font','Version':'1:2.0','Architecture':'all',
             'Filename':'pool/main/f/fixture/fixture-font_2.0_all.deb','Size':str(len(self.raw)),
             'SHA256':hashlib.sha256(self.raw).hexdigest()}]}
        self.identity={'schema':1,'source':SOURCE,'repository':'arcee-ai/nac','run_id':'123','attempt':2,
            'image':'ubuntu26@new','platform':apt.PLATFORM,'baseline':'b'*64,'plan_key':apt.store.key(self.plan),
            'requests':['fixture-font'],'tool':{'version':'1.62.1','bundle_sha256':'c'*64,'lock_sha256':apt.digest(apt.ROOT/'crates/nac-server/web/package-lock.json')}}
        self.download=self.root/'download';self.download.mkdir()
        apt.store.export(self.plan,{'fixture-font':self.input},self.download/'snapshot',{'source':SOURCE,'origin':'fixture'})
        self.producer=copy.deepcopy(self.identity);self.receipt=None;self.seal()
        self.env={**os.environ,'GITHUB_REPOSITORY':'arcee-ai/nac','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'2',
                  'ImageOS':'ubuntu26','ImageVersion':'new','PYTHONDONTWRITEBYTECODE':'1'}

    def seal(self):
        apt.write(self.state/'identity.json',self.identity);apt.write(self.state/'packages.json',self.plan)
        files={p.name:{'sha256':apt.digest(p),'bytes':p.stat().st_size}for p in (self.download/'snapshot').iterdir()}
        apt.write(self.download/'transport.json',{'schema':1,'identity':self.producer,'key':self.producer['plan_key'],'files':files})
        self.receipt={'schema':1,'identity':self.producer,'key':self.producer['plan_key'],
            'transport_sha256':apt.digest(self.download/'transport.json'),
            'transport_bytes':(self.download/'transport.json').stat().st_size}

    def cli(self,*,mode='ready',cold='false',download=True,receipt=None,env=None):
        args=[sys.executable,str(HERE/'browser-apt.py'),'consume','--state',str(self.state),'--source',SOURCE,
              '--cold',cold,'--producer-mode',mode]
        if download:args+=['--download',str(self.download)]
        result=subprocess.run(args,capture_output=True,timeout=15,env={**self.env,
            'BROWSER_APT_RECEIPT':json.dumps(self.receipt if receipt is None else receipt),**(env or {})})
        return result

    def reject(self,**kwargs):
        result=self.cli(**kwargs);self.assertNotEqual(result.returncode,0,result.stdout)
        self.assertFalse((self.state/'offer').exists());return result

    def normal(self,reason):
        result=self.cli();self.assertEqual(result.returncode,0,result.stderr.decode())
        value=apt.load(self.state/'consume.json');self.assertEqual(value['mode'],'normal')
        self.assertEqual(value['reason'],reason);self.assertFalse((self.state/'offer').exists())
        self.assertFalse((self.state/'validated').exists())

    def test_current_verified_hit_exposes_exact_package_bytes_once(self):
        result=self.cli();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(apt.load(self.state/'consume.json')['mode'],'verified-offer')
        self.assertEqual(next((self.state/'offer').iterdir()).read_bytes(),self.raw)
        self.assertNotEqual(self.cli().returncode,0,'duplicate offer cannot be overwritten')
        self.assertEqual(next((self.state/'offer').iterdir()).read_bytes(),self.raw)

    def test_valid_image_mismatch_is_normal_install_not_execution(self):
        self.producer['image']='ubuntu26@old';self.seal();self.normal('runner-image-change')

    def test_valid_older_attempt_is_current_normal_install(self):
        self.producer['attempt']=1;self.seal();self.normal('older-attempt')

    def test_valid_baseline_mismatch_is_normal_install(self):
        self.identity['baseline']='e'*64;self.seal();self.normal('native-baseline-change')

    def test_valid_current_plan_mismatch_is_normal_install(self):
        self.plan['packages'][0]['Version']='1:2.1';self.identity['plan_key']=apt.store.key(self.plan)
        self.seal();self.normal('current-plan-change')

    def test_unsupported_consumer_platform_is_normal_after_complete_validation(self):
        self.identity.update(platform='Linux-aarch64',tool=None,baseline=None,plan_key=None,requests=[])
        self.seal();self.normal('platform-change')

    def test_foreign_source_repository_run_future_and_malformed_identity_hard_fail(self):
        changes={'source':'e'*40,'repository':'foreign/repo','run_id':'124','attempt':3,'image':'',
                 'baseline':'short','platform':'foreign','tool':{},'requests':[]}
        for key,value in changes.items():
            with self.subTest(field=key):
                receipt=copy.deepcopy(self.receipt);receipt['identity'][key]=value;self.reject(receipt=receipt)
        self.reject(env={'ImageVersion':'different-current-environment'})

    def test_corruption_still_hard_fails_during_image_old_attempt_and_plan_mismatch(self):
        target=next((self.download/'snapshot').glob('*.deb'))
        for kind in ('image','attempt','plan'):
            with self.subTest(kind=kind):
                if kind=='image':self.producer['image']='ubuntu26@old'
                if kind=='attempt':self.producer['attempt']=1
                if kind=='plan':self.identity['baseline']='e'*64
                self.seal();target.write_bytes(b'corrupt');self.reject();target.write_bytes(self.raw)

    def test_missing_extra_symlink_hardlink_and_snapshot_link_never_exposed(self):
        payload=next((self.download/'snapshot').glob('*.deb'));payload.unlink();self.reject()
        payload.write_bytes(self.raw);extra=self.download/'extra';extra.write_text('foreign');self.reject();extra.unlink()
        payload.unlink();payload.symlink_to(self.input);self.reject();payload.unlink()
        os.link(self.input,payload);self.reject();payload.unlink();payload.write_bytes(self.raw)
        actual=self.root/'real-snapshot';(self.download/'snapshot').rename(actual)
        (self.download/'snapshot').symlink_to(actual);self.reject()

    def test_malformed_missing_duplicate_receipt_and_missing_download_fail(self):
        for text in ('','{}','{"schema":1,"schema":1}'):
            self.reject(env={'BROWSER_APT_RECEIPT':text})
        self.reject(download=False);(self.download/'transport.json').write_bytes(b'bad');self.reject()

    def test_cold_no_artifact_modes_never_read_archive_and_unknown_modes_fail(self):
        (self.download/'transport.json').write_bytes(b'bad unused evidence')
        for mode in sorted(apt.NO_ARTIFACT):
            cold='true'if mode=='disabled-cold'else'false'
            result=self.cli(mode=mode,cold=cold,download=False,env={'BROWSER_APT_RECEIPT':''})
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(apt.load(self.state/'consume.json')['reason'],mode)
        self.reject(mode='unknown',download=False)
        self.reject(mode='ready',cold='true')
        self.reject(mode='disabled-cold',cold='true',env={'BROWSER_APT_RECEIPT':''})
        self.reject(mode='nothing-missing',cold='true',download=False,env={'BROWSER_APT_RECEIPT':''})

    def test_foreign_plan_and_wrong_control_identity_fail_even_with_image_difference(self):
        self.producer['image']='ubuntu26@old'
        path=self.download/'snapshot/manifest.json';original=path.read_bytes()
        for field,value in [('repository','foreign/repo'),('Architecture','amd64')]:
            with self.subTest(field=field):
                manifest=json.loads(original)
                if field=='repository':manifest['plan']['repository']=value
                else:manifest['plan']['packages'][0][field]=value
                manifest['key']=apt.store.key(manifest['plan']);self.producer['plan_key']=manifest['key']
                apt.write(path,manifest);self.seal();self.reject()
        path.write_bytes(original)

    def test_malformed_current_authority_is_hard_during_image_difference(self):
        self.producer['image']='ubuntu26@old';self.plan['repository']='foreign/repo'
        self.seal();self.reject()

    def test_dangling_ownership_receipt_never_silently_clears_cleanup(self):
        cache=self.root/'cache';cache.mkdir();sentinel=cache/'unrelated';sentinel.write_text('keep')
        (self.state/'owned.json').symlink_to(self.root/'missing')
        with patch.object(apt,'CACHE',cache),patch.object(apt,'root_state'):
            with self.assertRaises(OSError):apt.cleanup(SimpleNamespace(state=self.state))
        self.assertEqual(sentinel.read_text(),'keep');self.assertFalse((self.state/'cleanup.json').exists())

    def test_tool_drift_is_hard_even_during_valid_image_difference(self):
        self.producer['image']='ubuntu26@old';self.identity['tool']['bundle_sha256']='e'*64
        self.seal();self.reject()

    def test_real_root_offer_partial_copy_duplicate_and_cleanup_keep_foreign_inodes(self):
        self.assertEqual(self.cli().returncode,0)
        cache=self.root/'cache';cache.mkdir();sentinel=cache/'unrelated';sentinel.write_bytes(b'foreign')
        args=SimpleNamespace(state=self.state,operation='offer',github_output=None)
        with patch.object(apt,'CACHE',cache),patch.object(apt,'root_state'):
            apt.offer(args);owned=apt.load(self.state/'owned.json');path=cache/owned[0]['name']
            self.assertEqual(path.read_bytes(),self.raw)
            with self.assertRaisesRegex(ValueError,'already attempted'):apt.offer(args)
            self.assertEqual(apt.load(self.state/'owned.json'),owned)
            other=cache/'replacement';other.write_bytes(b'foreign replacement');os.replace(other,path)
            with self.assertRaisesRegex(ValueError,'foreign cache replacement'):apt.cleanup(args)
            self.assertEqual(path.read_bytes(),b'foreign replacement');path.unlink();apt.cleanup(args)
            self.assertEqual(sentinel.read_bytes(),b'foreign');self.assertTrue(apt.load(self.state/'cleanup.json')[0]['absent'])
        # A second owned state verifies cleanup of partial bytes after failed copy.
        (self.state/'owned.json').unlink()
        def partial(_source,out,_size):out.write(b'partial');raise OSError('owned interrupted copy')
        with patch.object(apt,'CACHE',cache),patch.object(apt,'root_state'),patch.object(shutil,'copyfileobj',side_effect=partial):
            with self.assertRaises(OSError):apt.offer(args)
        with patch.object(apt,'CACHE',cache),patch.object(apt,'root_state'):apt.cleanup(args)
        self.assertEqual(list(cache.iterdir()),[sentinel])

    def test_real_cache_directory_link_or_writable_root_is_rejected(self):
        args=SimpleNamespace(state=self.state)
        cache=self.root/'cache';cache.mkdir();link=self.root/'linked';link.symlink_to(cache)
        with patch.object(apt,'CACHE',link),patch.object(apt.os,'geteuid',return_value=0),\
             patch.dict(os.environ,{'SUDO_UID':str(os.getuid()),'SUDO_GID':str(os.getgid())}):
            with self.assertRaisesRegex(ValueError,'unsafe root APT cache'):apt.root_state(args)
        cache.chmod(0o777);original=Path.lstat
        def inspect(path):
            info=original(path)
            return info if path==self.state else SimpleNamespace(st_mode=info.st_mode,st_uid=0)
        with patch.object(apt,'CACHE',cache),patch.object(apt.os,'geteuid',return_value=0),\
             patch.dict(os.environ,{'SUDO_UID':str(os.getuid()),'SUDO_GID':str(os.getgid())}),\
             patch.object(Path,'lstat',side_effect=inspect,autospec=True):
            with self.assertRaisesRegex(ValueError,'unsafe root APT cache'):apt.root_state(args)

    def test_selected_uri_binding_and_removals_fail_closed(self):
        text="'mirror+file:/native/pool/main/f/font/font_1%2b2_all.deb' font_1+2_all.deb 123 SHA256:x\n"
        self.assertEqual(apt.offers(text),{'font_1+2_all.deb':('pool/main/f/font/font_1+2_all.deb',123)})
        self.assertEqual(apt.selected('0 newly installed'),[])
        with self.assertRaises(ValueError):apt.selected('Remv real-package [1.0]')
        with self.assertRaises(ValueError):apt.offers("'file:/etc/passwd' unsafe 3 x")

    def test_native_plan_and_mode_survive_export_as_separate_protocol_files(self):
        metadata=self.root/'native_InRelease';metadata.write_text('fixture: signed-update command mocked')
        cache=self.root/'empty-cache';cache.mkdir()
        target=self.state/'packages.json';target.unlink(missing_ok=True)
        row=self.plan['packages'][0]
        outputs={'signed-update':'','solver':'Inst fixture-font (1:2.0 Ubuntu [all])\n',
            'uris':f"'http://native/{row['Filename']}' {apt.store.offer_name(row)} {row['Size']} SHA256:x\n",
            'records':'\n'.join(k+': '+v for k,v in row.items())+'\n\n'}
        def command(state,label,args,**kwargs):
            if label=='prefetch':
                (kwargs['cwd']/apt.store.offer_name(row)).write_bytes(self.raw);return ''
            return outputs[label]
        args=SimpleNamespace(state=self.state,operation='plan',github_output=None)
        with patch.object(apt,'run',side_effect=command),patch.object(apt,'CACHE',cache),\
             patch.object(apt,'requests',return_value=(self.identity['requests'],self.identity['tool'])),\
             patch.object(apt,'digest',return_value='b'*64),patch.object(Path,'glob',return_value=[metadata]):
            apt.plan(args)
        self.assertEqual(apt.load(target),self.plan)
        self.assertEqual(apt.load(self.state/'plan.json')['mode'],'ready')
        args.operation='export'
        with patch.object(apt,'run',side_effect=command):apt.export(args)
        result=apt.load(self.state/'export.json')
        self.assertEqual(result['receipt']['transport_sha256'],apt.digest(self.state/'artifact/transport.json'))
        self.assertEqual(result['copied_bytes'],len(self.raw))

    def test_actual_owned_child_timeout_is_nonzero_no_retry_and_settled(self):
        path=self.root/'pid'
        command=[sys.executable,'-c','import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);'
                 f'open({str(path)!r},"w").write(str(os.getpid()));time.sleep(30)']
        with self.assertRaisesRegex(ValueError,'timeout'):apt.run(self.state,'owned-child',command,timeout=.3)
        pid=int(path.read_text())
        with self.assertRaises(ProcessLookupError):os.kill(pid,0)
        self.assertIsNotNone(apt.load(self.state/'owned-child-command.json')['error'])
        with self.assertRaisesRegex(ValueError,'already attempted'):apt.run(self.state,'owned-child',command)


import shutil
if __name__=='__main__':unittest.main()
