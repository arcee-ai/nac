#!/usr/bin/env python3
"""Admission CLI, owned cache I/O and real controller cancellation controls."""
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

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,HERE/path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result

runtime=module('runtime','apt-runtime-parity.py')
fixture=module('fixture','apt-archive-store.test.py')


class RuntimeBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.state=self.root/'state';self.state.mkdir(mode=0o700)
        self.deb_bytes=fixture.deb()
        self.plan={'schema':1,'repository':'arcee-ai/nac','platform':'ubuntu26.04-amd64-amd64v3',
            'packages':[{'Package':'fixture-font','Version':'1:2.0','Architecture':'all',
                'Filename':'pool/main/f/fixture/fixture-font_2.0_all.deb',
                'Size':str(len(self.deb_bytes)),'SHA256':hashlib.sha256(self.deb_bytes).hexdigest()}]}
        self.identity={'schema':1,'source':'a'*40,'repository':'arcee-ai/nac','run_id':'123',
            'attempt':'1','lane':'hit','ImageOS':'ubuntu26','ImageVersion':'123.1',
            'dpkg_status_sha256':'b'*64,'plan_key':runtime.store.key(self.plan),
            'playwright':{'version':'locked','bundle_sha256':'c'*64,'lock_sha256':'d'*64},
            'requests':['fixture-font']}
        runtime.write(self.state/'identity.json',self.identity);runtime.write(self.state/'plan.json',self.plan)
        self.download=self.root/'download';self.download.mkdir()
        source=self.root/'fixture.deb';source.write_bytes(self.deb_bytes)
        runtime.store.export(self.plan,{'fixture-font':source},self.download/'snapshot',
                             {'source':'a'*40,'origin':'same-run-unprivileged-artifact-no-shared-cache-write'})
        producer={**self.identity,'lane':'producer'}
        files={p.name:{'sha256':runtime.sha(p),'bytes':p.stat().st_size}for p in (self.download/'snapshot').iterdir()}
        runtime.write(self.download/'transport.json',{'schema':1,'identity':producer,
                      'files':files,'key':self.identity['plan_key']})
        self.receipt={'schema':1,'identity':producer,'key':self.identity['plan_key'],
            'transport_sha256':runtime.sha(self.download/'transport.json'),
            'transport_bytes':(self.download/'transport.json').stat().st_size}

    def cli(self,operation='admit',*,receipt=None,download=True,extra=(),env=None):
        args=[sys.executable,str(HERE/'apt-runtime-parity.py'),operation,'--state',str(self.state)]
        if download:args+=['--download',str(self.download)]
        args+=extra
        values={**os.environ,'APT_ARTIFACT_RECEIPT':json.dumps(self.receipt if receipt is None else receipt),
                'PYTHONDONTWRITEBYTECODE':'1',**(env or {})}
        return subprocess.run(args,env=values,capture_output=True,timeout=15)

    def reject(self,**kwargs):
        result=self.cli(**kwargs);self.assertNotEqual(result.returncode,0,result.stdout)
        self.assertFalse((self.state/'offer').exists())
        self.assertIsNotNone(runtime.load(self.state/'phase-admit.json')['error'])

    def test_real_cli_verified_hit_exposes_exact_bytes_once(self):
        result=self.cli();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(runtime.load(self.state/'admission.json')['mode'],'verified-hit')
        offered=list((self.state/'offer').iterdir());self.assertEqual(len(offered),1)
        self.assertEqual(offered[0].read_bytes(),self.deb_bytes)
        again=self.cli();self.assertNotEqual(again.returncode,0)
        self.assertEqual(offered[0].read_bytes(),self.deb_bytes)

    def test_cold_never_reads_missing_or_corrupt_download(self):
        self.identity['lane']='cold';runtime.write(self.state/'identity.json',self.identity)
        (self.download/'transport.json').write_bytes(b'corrupt unused bytes')
        result=self.cli(download=False);self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(runtime.load(self.state/'admission.json')['mode'],'cold-no-package-artifact-read')
        self.assertFalse((self.state/'offer').exists())
        self.assertNotEqual(self.cli().returncode,0,'cold must reject a download argument')

    def test_foreign_future_old_source_image_baseline_plan_and_lock_fail_before_offer(self):
        changes={'source':'e'*40,'repository':'foreign/repo','run_id':'124','attempt':'2',
                 'ImageOS':'ubuntu24','ImageVersion':'other','dpkg_status_sha256':'e'*64,
                 'plan_key':'f'*64,'requests':['other'],'playwright':{'version':'other'}}
        for name,value in changes.items():
            with self.subTest(name=name):
                receipt=copy.deepcopy(self.receipt);receipt['identity'][name]=value;self.reject(receipt=receipt)
        receipt=copy.deepcopy(self.receipt);receipt['identity']['attempt']='0';self.reject(receipt=receipt)

    def test_corrupt_transport_and_payload_partial_extra_link_hardlink_rejected(self):
        original=(self.download/'transport.json').read_bytes()
        (self.download/'transport.json').write_bytes(b'corrupt');self.reject()
        (self.download/'transport.json').write_bytes(original)
        payload=next((self.download/'snapshot').glob('*.deb'));raw=payload.read_bytes()
        payload.write_bytes(raw[:10]);self.reject();payload.write_bytes(raw)
        extra=self.download/'unexpected';extra.write_text('foreign');self.reject();extra.unlink()
        payload.unlink();payload.symlink_to(self.root/'fixture.deb');self.reject();payload.unlink()
        os.link(self.root/'fixture.deb',payload);self.reject();payload.unlink()
        payload.write_bytes(raw);payload.unlink();self.reject()

    def test_duplicate_receipt_and_missing_receipt_cli_fail(self):
        for value in ('','{"schema":1,"schema":1}'):
            self.reject(env={'APT_ARTIFACT_RECEIPT':value})

    def test_safe_uri_uses_signed_pool_and_decodes_apt_epoch_escaping(self):
        text="'http://azure.archive.ubuntu.com/ubuntu/pool/main/f/font/font_1%2b2_all.deb' font_1+2_all.deb 123 SHA256:abc\n"
        self.assertEqual(runtime.selected_offers(text),{'font_1+2_all.deb':('pool/main/f/font/font_1+2_all.deb',123)})
        for text in ("'file:/tmp/a' a 3 x", "'https://host/foreign/a' a 3 x"):
            with self.assertRaises(ValueError):runtime.selected_offers(text)

    def test_root_offer_and_cleanup_exact_inode_foreign_replacement_refused(self):
        self.assertEqual(self.cli().returncode,0)
        cache=self.root/'apt-cache';cache.mkdir()
        args=SimpleNamespace(state=self.state)
        env={'SUDO_UID':str(os.getuid()),'SUDO_GID':str(os.getgid())}
        with patch.object(runtime,'CACHE',cache),patch.object(runtime,'cache_root'),\
             patch.object(runtime.os,'geteuid',return_value=0),patch.dict(os.environ,env):
            runtime.offer_root(args)
            offered=next(cache.iterdir());self.assertEqual(offered.read_bytes(),self.deb_bytes)
            with self.assertRaisesRegex(ValueError,'already attempted'):runtime.offer_root(args)
            # A failed duplicate offer must not erase the original ownership receipt.
            first={'name':offered.name,'device':offered.stat().st_dev,'inode':offered.stat().st_ino}
            self.assertEqual(runtime.load(self.state/'owned-offers.json'),[first])
            foreign=cache/'foreign';foreign.write_bytes(b'foreign');os.replace(foreign,offered)
            with self.assertRaisesRegex(ValueError,'foreign cache replacement'):runtime.cleanup_root(args)
            self.assertEqual(offered.read_bytes(),b'foreign')
            offered.unlink();runtime.cleanup_root(args)
            self.assertTrue(runtime.load(self.state/'offer-cleanup.json')[0]['owned_inode_absent'])

    def test_partial_root_copy_is_retained_then_only_its_exact_inode_cleaned(self):
        self.assertEqual(self.cli().returncode,0)
        cache=self.root/'apt-cache';cache.mkdir();args=SimpleNamespace(state=self.state)
        def partial(_source,destination,_size):
            destination.write(b'partial');raise OSError('owned copy interrupted')
        env={'SUDO_UID':str(os.getuid()),'SUDO_GID':str(os.getgid())}
        import shutil
        with patch.object(runtime,'CACHE',cache),patch.object(runtime,'cache_root'),\
             patch.object(runtime.os,'geteuid',return_value=0),patch.dict(os.environ,env):
            with patch.object(shutil,'copyfileobj',side_effect=partial):
                with self.assertRaisesRegex(OSError,'owned copy interrupted'):runtime.offer_root(args)
            self.assertEqual(len(runtime.load(self.state/'owned-offers.json')),1)
            self.assertEqual(next(cache.iterdir()).read_bytes(),b'partial')
            runtime.cleanup_root(args);self.assertFalse(list(cache.iterdir()))

    def test_browser_cli_rejects_wrong_version_or_full_guide_identity_before_launch(self):
        binary=self.root/'fixture-binary'
        version=(runtime.ROOT/'version.txt').read_text().strip()
        for valid_version in (False,True):
            version_text=f'nac-web {version} ({"a"*12})'if valid_version else 'wrong source'
            binary.write_text('#!'+sys.executable+'\nimport sys,json\n'
                f'print({version_text!r} if sys.argv[1]=="--version" else json.dumps({{"provenance":"first-party bundled NAC Guide","build_identity":{{"source_revision":"wrong"}}}}))\n')
            binary.chmod(0o700)
            result=subprocess.run(['node',str(HERE/'apt-runtime-browser.mjs'),'--state',str(self.state)],
                env={**os.environ,'NAC_E2E_BINARY':str(binary)},capture_output=True,timeout=15)
            self.assertNotEqual(result.returncode,0);self.assertFalse((self.state/'browser.json').exists())
            self.assertIn(b'AssertionError',result.stderr)

    def test_cache_root_rejects_link_and_writable_parent(self):
        cache=self.root/'cache';cache.mkdir();link=self.root/'link';link.symlink_to(cache)
        with patch.object(runtime.os,'getuid',return_value=0):
            with self.assertRaises(ValueError):runtime.cache_root(link)
            cache.chmod(0o777)
            with self.assertRaises(ValueError):runtime.cache_root(cache)

    def test_real_child_nonzero_is_retained_and_unsafe_label_cannot_write(self):
        state=runtime.State(self.state)
        with self.assertRaisesRegex(ValueError,'exit7'):
            state.run('failure',[sys.executable,'-c','import sys;print("retained");sys.exit(7)'])
        self.assertEqual((self.state/'failure.stdout.log').read_text(),'retained\n')
        self.assertEqual(runtime.load(self.state/'commands.json')[-1]['exit'],7)
        with self.assertRaisesRegex(ValueError,'unsafe command label'):
            state.run('../foreign',[sys.executable,'-c','pass'])
        self.assertFalse((self.root/'foreign.stdout.log').exists())

    def test_real_sigint_and_sigterm_kill_only_created_ignoring_child_group(self):
        for signum in (signal.SIGINT,signal.SIGTERM):
            with self.subTest(signal=signum):
                ready=self.root/str(signum);ready.mkdir()
                child=subprocess.Popen([sys.executable,str(HERE/'apt-runtime-parity.py'),'execute',
                    '--state',str(ready),'--label','owned','--timeout','10','--',sys.executable,'-c',
                    'import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);'
                    f'open({str(ready/"pid")!r},"w").write(str(os.getpid()));time.sleep(30)'],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                try:
                    until=time.monotonic()+5
                    while not(ready/'pid').exists()and time.monotonic()<until:time.sleep(.01)
                    self.assertTrue((ready/'pid').exists())
                    pid=int((ready/'pid').read_text());child.send_signal(signum)
                    out,err=child.communicate(timeout=5);self.assertNotEqual(child.returncode,0,(out,err))
                    with self.assertRaises(ProcessLookupError):os.kill(pid,0)
                    self.assertTrue(runtime.load(ready/'commands.json')[-1]['interrupted'])
                    self.assertIsNotNone(runtime.load(ready/'phase-execute.json')['error'])
                finally:
                    if child.poll()is None:child.kill();child.wait()

    def test_real_descendant_pipe_leak_fails_and_owned_group_is_settled(self):
        child_pid=self.root/'descendant.pid'
        script='import subprocess,sys;'+f'p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]);open({str(child_pid)!r},"w").write(str(p.pid))'
        with self.assertRaisesRegex(ValueError,'incomplete/bounded child capture'):
            runtime.State(self.state).run('leak',[sys.executable,'-c',script])
        row=runtime.load(self.state/'commands.json')[-1]
        self.assertTrue(row['descendant_pipe_leak']);self.assertEqual(row['exit'],0)
        result=subprocess.run(['ps','-p',child_pid.read_text(),'-o','stat='],capture_output=True,text=True)
        self.assertTrue(result.returncode or result.stdout.strip().startswith('Z'),result.stdout)

    def test_child_marker_is_never_in_controller_or_nonfixture_commands(self):
        self.assertNotIn('NAC_E2E_CLEANUP_ID',os.environ)
        state=runtime.State(self.state)
        text=state.run('journeys',[sys.executable,'-c','import os;print(os.environ["NAC_E2E_CLEANUP_ID"])'])
        self.assertEqual(text.strip(),'apt-parity-123-1-hit')
        output=state.run('browser-check',[sys.executable,'-c','import os;print(os.environ["NAC_E2E_ARTIFACTS"])'])
        self.assertEqual(output.strip(),str(self.state.resolve()/'test-results'))
        text=state.run('not-fixture',[sys.executable,'-c','import os;print("NAC_E2E_CLEANUP_ID"in os.environ)'])
        self.assertEqual(text.strip(),'False')

    def result(self):
        return {'config':{'workers':1,'projects':[{'retries':0}]},'errors':[],
            'suites':[{'specs':[{'title':title,'tests':[{'expectedStatus':'passed','results':[
                {'status':'passed','retry':0}]}]}for title in runtime.TITLES]}],
            'stats':{'expected':3,'unexpected':0,'flaky':0,'skipped':0}}

    def test_journey_assertion_skip_retry_worker_and_exact_selection_guards(self):
        runtime.check_journeys(self.result())
        mutations=[lambda r:r['config'].update(workers=2),lambda r:r['config']['projects'][0].update(retries=1),
            lambda r:r['stats'].update(skipped=1),lambda r:r['suites'][0]['specs'].pop(),
            lambda r:r['suites'][0]['specs'][0]['tests'][0]['results'][0].update(status='failed'),
            lambda r:r['suites'][0]['specs'][0]['tests'][0]['results'][0].update(retry=1)]
        for mutate in mutations:
            value=self.result();mutate(value)
            with self.assertRaises(ValueError):runtime.check_journeys(value)

    def test_compare_requires_same_installed_fonts_browser_binary_and_api(self):
        cold={'status':'passed representative native parity; not full-suite/cache-service qualification',
            'identity':{**self.identity,'lane':'cold'},'admission':{'mode':'cold-no-package-artifact-read'},
            'runtime':{'installed':{'fonts':['exactbytes']},'browser':{'binary_sha256':'a'*64},'API_build':'a'*40}}
        hit={**copy.deepcopy(cold),'identity':self.identity,'admission':{'mode':'verified-hit'}}
        a=self.state/'cold.json';b=self.state/'hit.json';runtime.write(a,cold);runtime.write(b,hit)
        args=SimpleNamespace(cold=a,hit=b);runtime.compare(args)
        for field in ('installed','browser','API_build'):
            changed=copy.deepcopy(hit);changed['runtime'][field]='different';runtime.write(b,changed)
            with self.assertRaisesRegex(ValueError,'parity differs'):runtime.compare(args)


if __name__=='__main__':unittest.main()
