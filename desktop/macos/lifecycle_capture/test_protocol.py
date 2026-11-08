"""Inert protocol/collector controls: synthetic bytes, no native app or database."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from . import protocol as p,collector as c
from .owners import settle_independently,runner_settled


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.config=dict(case='run',nonce='a'*64,configuration_sha256='b'*64,case_root=str(self.root),helper_token='helper')
        self.requests=[];self.fences=[];self.found={}
        for ordinal in (1,2):
            binding=dict(app_pid=123,engine_pid=124,workspace_window_number=55,launch_incarnation='incarnation',ready_source=p.P,
                ready_store=str(self.root/'nac-lifecycle-app-fixture/run/store.db'),quit_confirmation_decisions=ordinal,
                quit_sheet_presentations=ordinal,quit_cancel_choices=ordinal-1,quit_stop_completions=0,
                phase=p.PHASES[ordinal-1],confirmation_id='confirm'+str(ordinal),sheet_window=60+ordinal,document='document')
            request=dict(schema='lifecycle-request-v1',case='run',ordinal=ordinal,nonce=self.config['nonce'],
                configuration_sha256=self.config['configuration_sha256'],binding=binding,
                app_path=str(self.root/'nac-lifecycle-app-fixture/Relocated app folder with spaces/NAC Lifecycle Smoke.app'),
                native_path=str(self.root/'run/native.json'))
            self.requests.append(request);self.fences.append(dict(request=request,release=p.release(request),before=binding,after=binding))
            base=ordinal*10**10
            proof=dict(schema='lifecycle-proof-v1',status='ready',nonce=self.config['nonce'],configuration_sha256=self.config['configuration_sha256'],
                request_sha256=p.digest(p.encoded(request)),ordinal=ordinal,owner=binding,app_path=request['app_path'],
                began_ns=str(base+100),ended_ns=str(base+200),sequence=str(ordinal*2-1),helper_token='helper',root_token='root',
                sheet_token='sheet'+str(ordinal),cancel_token='cancel'+str(ordinal),stop_token='stop'+str(ordinal),
                root_frame=[0,0,500,500],sheet_frame=[100,100,300,100],cancel_frame=[110,110,50,40],stop_frame=[200,110,50,40],
                screen_frame=[0,0,1000,1000],engine_birth=[124,100,5],app_launch_epoch=100.5)
            after=dict(proof,began_ns=str(base+600),ended_ns=str(base+700),sequence=str(ordinal*2))
            png=b'\x89PNG\r\n\x1a\n' + bytes([ordinal])*40
            meta=dict(schema='lifecycle-screen-v1',ordinal=ordinal,configuration_sha256=self.config['configuration_sha256'],nonce=self.config['nonce'],
                request_sha256=p.digest(p.encoded(request)),before=proof,after=after,png_sha256=p.digest(png),png_bytes=len(png),
                capture_method='public-XCTest-main-screen',new_input_actions=0,manual_visual_acceptance=False,
                capture_began_ns=str(base+250),capture_ended_ns=str(base+500),
                runner=dict(pid=321,parent=1,uid=os.getuid(),start_seconds=100,start_microseconds=5,executable='/private/derived/NACLifecycleCaptureUITests-Runner'))
            self.found[(ordinal,'screen')]=png;self.found[(ordinal,'caption')]=p.encoded(meta)
        self.origin=dict(nodeType='Test Case',nodeIdentifierURL=p.TESTS['run'],nodeIdentifier='run',result='Passed')
    def tearDown(self):self.temp.cleanup()
    def joined(self):return c.join(self.config,self.requests,self.fences,self.found,origin=self.origin)
    def edit(self,ordinal,fn):
        m=json.loads(self.found[(ordinal,'caption')]);fn(m);self.found[(ordinal,'caption')]=p.encoded(m)


class Protocol(Fixture):
    def test_positive_full_join_requires_review(self):
        rows=self.joined();self.assertEqual(len(rows),2)
        self.assertTrue(all(x['structural_capture_complete'] and not x['composited_acceptance'] and x['actual_pixel_review_required'] for x in rows))
    def test_public_prefix_is_not_final_private_acceptance(self):
        rows=c.public_join(self.config,self.requests,self.found,origin=self.origin)
        self.assertTrue(all('structural_capture_complete' not in x for x in rows))
        with self.assertRaises(RuntimeError):c.join(self.config,self.requests,[],self.found,origin=self.origin)
    def test_release_never_contains_png_hash(self):
        r=p.release(self.requests[0]);self.assertIs(r['capture_verified'],False)
        self.assertNotIn('png_sha256',r)
        for field,value in [('png_sha256','c'*64),('capture_verified',True),('ordinal',2)]:
            bad=dict(r,**{field:value})
            with self.assertRaises(RuntimeError):p.require_release(bad,self.requests[0])
    def test_request_malformed_or_phase_reentry(self):
        for mutate in [lambda r:r.update(ordinal=True),lambda r:r.update(nonce='other'),lambda r:r['binding'].update(app_pid=True),
                       lambda r:r['binding'].update(quit_cancel_choices=1),lambda r:r.update(native_path='/tmp/other.json'),
                       lambda r:r['binding'].update(ready_store='/tmp/other.db'),lambda r:r.update(extra='x')]:
            row=copy.deepcopy(self.requests[0]);mutate(row)
            with self.assertRaises(RuntimeError):p.require_request(row,self.config,1)
    def test_selected_uri_uses_project_namespace_and_refuses_old_prefix(self):
        expected='test://com.apple.xcode/NACNativeUITests/NACLifecycleCaptureUITests/LifecycleCaptureJourneys/testCaptureRun'
        self.assertEqual(p.TESTS['run'],expected)
        self.assertIs(c.selected_test({'testNodes':[self.origin]},'run'),self.origin)
        self.origin['nodeIdentifierURL']=expected.replace('/NACNativeUITests/','/NACLifecycleCaptureUITests/',1)
        with self.assertRaises(RuntimeError):c.selected_test({'testNodes':[self.origin]},'run')

    def test_witness_geometry_shapes_cannot_bypass_join(self):
        for field in ('root_frame','sheet_frame','cancel_frame','stop_frame','screen_frame'):
            for invalid in (None,{},'rectangle',[0,0,500],[0,0,False,500],[0,0,0,500],[0,0,500,-1]):
                with self.subTest(field=field,invalid=invalid):
                    saved=self.found[(1,'caption')]
                    self.edit(1,lambda m:[m[k].update({field:invalid}) for k in ('before','after')])
                    with self.assertRaises(RuntimeError):self.joined()
                    self.found[(1,'caption')]=saved
    def test_missing_or_replaced_witness_control_owner_refused(self):
        for field in ('root_token','sheet_token','cancel_token','stop_token'):
            for invalid in (None,'',False):
                with self.subTest(field=field,invalid=invalid):
                    saved=self.found[(1,'caption')]
                    self.edit(1,lambda m:[m[k].update({field:invalid}) for k in ('before','after')])
                    with self.assertRaises(RuntimeError):self.joined()
                    self.found[(1,'caption')]=saved
            saved=self.found[(1,'caption')]
            self.edit(1,lambda m:m['after'].update({field:'replaced-owner'}))
            with self.assertRaises(RuntimeError):self.joined()
            self.found[(1,'caption')]=saved

    def test_private_after_owner_changed(self):
        self.fences[1]=copy.deepcopy(self.fences[1]);self.fences[1]['after']['engine_pid']=999
        with self.assertRaises(RuntimeError):self.joined()
    def test_png_digest_or_pair_missing(self):
        self.found[(1,'screen')]+=b'changed'
        with self.assertRaises(RuntimeError):self.joined()
    def test_wrong_test_uri_or_status(self):
        for k,v in [('nodeIdentifierURL',p.TESTS['approval']),('result','Failed')]:
            old=self.origin[k];self.origin[k]=v
            with self.assertRaises(RuntimeError):self.joined()
            self.origin[k]=old
    def test_owner_or_geometry_changed_during_capture(self):
        self.edit(1,lambda m:m['after'].update(sheet_token='replacement'))
        with self.assertRaises(RuntimeError):self.joined()
    def test_wrong_external_helper(self):
        self.config['helper_token']='forged'
        with self.assertRaises(RuntimeError):self.joined()
    def test_stale_or_reversed_sample(self):
        self.edit(1,lambda m:m['after'].update(began_ns=m['before']['began_ns']))
        with self.assertRaises(RuntimeError):self.joined()
    def test_capture_not_bracketed(self):
        self.edit(1,lambda m:m.update(capture_began_ns=m['before']['began_ns']))
        with self.assertRaises(RuntimeError):self.joined()
    def test_capture_over_ten_seconds(self):
        self.edit(1,lambda m:m.update(capture_ended_ns=str(int(m['capture_began_ns'])+11*10**9)))
        with self.assertRaises(RuntimeError):self.joined()
    def test_changed_owner_between_confirmations(self):
        # Even re-signed metadata cannot replace the durable engine across phases.
        self.requests[1]['binding']['engine_pid']=777
        self.edit(2,lambda m:m.update(request_sha256=p.digest(p.encoded(self.requests[1]))))
        with self.assertRaises(RuntimeError):self.joined()
    def test_same_sheet_reused(self):
        self.edit(2,lambda m:[m[k].update(sheet_token='sheet1') for k in ('before','after')])
        with self.assertRaises(RuntimeError):self.joined()
    def test_new_input_or_visual_acceptance_rejected(self):
        for key,value in [('new_input_actions',1),('manual_visual_acceptance',True),('new_input_actions',False)]:
            saved=self.found[(1,'caption')];self.edit(1,lambda m:m.update(**{key:value}))
            with self.assertRaises(RuntimeError):self.joined()
            self.found[(1,'caption')]=saved
    def test_exclusive_publication_and_no_reentry(self):
        f=self.root/'release.json';p.publish(f,{'capture_verified':False})
        self.assertIs(p.read(f)['capture_verified'],False)
        with self.assertRaises(RuntimeError):p.publish(f,{'capture_verified':True})
    def test_duplicate_keys_symlink_and_hardlink_refused(self):
        f=self.root/'record';f.write_text('{"a":1,"a":2}')
        with self.assertRaises(RuntimeError):p.read(f)
        link=self.root/'alias';link.symlink_to(f)
        with self.assertRaises(RuntimeError):p.read(link)
        link.unlink();os.link(f,link)
        with self.assertRaises(RuntimeError):p.read(f)
    def test_unsettled_runner_cannot_release(self):
        identity=json.loads(self.found[(1,'caption')])['runner']
        with self.assertRaises(RuntimeError):runner_settled(self.found,probe=lambda _:identity)
        self.assertTrue(runner_settled(self.found,probe=lambda _:None)['old_generation_settled'])
        self.assertTrue(runner_settled(self.found,probe=lambda _:dict(identity,start_seconds=101))['old_generation_settled'])
    def test_cleanup_owners_all_attempted_primary_preserved(self):
        first=ValueError('original');calls=[]
        def fail():calls.append('first');raise RuntimeError('settlement')
        with self.assertRaises(ValueError) as caught:
            settle_independently([('one',fail),('two',lambda:calls.append('second'))],first)
        self.assertIs(caught.exception,first);self.assertEqual(calls,['first','second'])
    def test_attachment_inventory_duplicate_missing_wrong_group(self):
        folder=self.root/'export';folder.mkdir();entries=[]
        for (i,k),data in self.found.items():
            name=f'lifecycle-{k}-{i}';leaf=name+('.png' if k=='screen' else '.json')
            (folder/leaf).write_bytes(data);entries.append(dict(suggestedHumanReadableName=name,exportedFileName=leaf))
        group=dict(testIdentifier='run',testIdentifierURL=p.TESTS['run'],attachments=entries)
        found,test=c.pairs(folder,[group],{'testNodes':[self.origin]},'run');self.assertEqual(found,self.found)
        group['attachments']=[*entries,entries[0]]
        with self.assertRaises(RuntimeError):c.pairs(folder,[group],{'testNodes':[self.origin]},'run')
        group['attachments']=entries[:-1]
        with self.assertRaises(RuntimeError):c.pairs(folder,[group],{'testNodes':[self.origin]},'run')
        group['attachments']=entries;group['testIdentifier']='foreign'
        with self.assertRaises(RuntimeError):c.pairs(folder,[group],{'testNodes':[self.origin]},'run')


if __name__=='__main__':unittest.main()
