"""Strict optional-contract controls; no compiler or native actor."""
import json
import copy
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

import ci_startup_client_rejection as diagnostic
import test_ci_startup_attachments as canonical
from ci_startup_attachments import collect
import unittest
from ci_startup_client_rejection import validate,ClientRejectionError

class ClientRecordControls(unittest.TestCase):
    def row(self):
        config=dict(scenario='configuredLocal',source_sha='a'*40,test_source_sha='b'*40,harness_sha='c'*40,
                    startup_source_sha256='d'*64,ax_witness={'helper_sha256':'e'*64})
        witness=dict(app_pid=400,app_launch_epoch=10.,window_number=41)
        row={k:config[k] for k in ('source_sha','test_source_sha','harness_sha','startup_source_sha256')}
        row.update(witness,schema='nac342-ax-client-rejection-v1',acceptance=False,scenario='configuredLocal',
            configuration_sha256='f'*64,helper_sha256='e'*64,gate='receipt_status_not_ready',guard_site='initial_guard',
            client_phase='begin',receipt_status='refused',refusal_stage='sample_deadline',reader_terminal='absent',
            sequence='1',refusal_generation='1',began_ns='1',ended_ns='2',case_deadline_ns='10',
            failure_payload_present=False,observation_present=False)
        return row,config,witness

    def test_exact_nonready_record_cannot_be_ready_or_private_or_unbound(self):
        row,config,witness=self.row()
        self.assertEqual(validate(json.dumps(row).encode(),config,'f'*64,witness),row)
        for change in [{'acceptance':True},{'receipt_status':'ready'},{'sequence':True},{'sequence':'01'},
                       {'sequence':str(2**64)},{'window_number':42},{'reader_terminal':'PRIVATE'},
                       {'harness_sha':'0'*40},{'helper_sha256':'0'*64},{'private':'PRIVATE'},
                       {'failure_payload_present':1},{'app_launch_epoch':float('nan')}]:
            with self.subTest(change=change),self.assertRaises((RuntimeError,ValueError,TypeError)):
                validate(json.dumps(dict(row,**change)).encode(),config,'f'*64,witness)
        with self.assertRaises(RuntimeError):validate(b' '*2049,config,'f'*64,witness)
        encoded=json.dumps(row).encode();duplicate=encoded[:-1]+b',"acceptance":false}'
        with self.assertRaises(RuntimeError):validate(duplicate,config,'f'*64,witness)


    def test_every_required_field_binding_counter_interval_and_enum_is_closed(self):
        original,config,witness=self.row()
        payloads=[]
        for name in original:
            value=copy.deepcopy(original);value.pop(name);payloads.append(json.dumps(value).encode())
        for name in ['source_sha','test_source_sha','harness_sha','startup_source_sha256','configuration_sha256','helper_sha256']:
            payloads.append(json.dumps({**original,name:'0'*len(original[name])}).encode())
        for name in ['sequence','refusal_generation','began_ns','ended_ns','case_deadline_ns']:
            for value in [True,0,-1,'-1','00','1.0',str(2**64)]:payloads.append(json.dumps({**original,name:value}).encode())
        for change in [{'sequence':'0'},{'began_ns':'3'},{'ended_ns':'10'},{'window_number':True},
                       {'app_pid':0},{'app_launch_epoch':float('inf')},{'guard_site':'foreign'},
                       {'client_phase':'foreign'},{'refusal_stage':'PRIVATE'},{'observation_present':1},
                       {'reader_terminal':'owned_pid'},{'scenario':'onboarding'},{'gate':'ready'}]:
            payloads.append(json.dumps({**original,**change}).encode())
        payloads.extend([b'[]',b'true',b'null',b'{"partial":',b'\xff'])
        for data in payloads:
            with self.subTest(data=data[:100]),self.assertRaises((RuntimeError,ValueError,TypeError)):
                validate(data,config,'f'*64,witness)
        for status in ['refused','retiring','retired','other']:
            row={**original,'receipt_status':status,'refusal_generation':str(2**64-1)}
            self.assertEqual(validate(json.dumps(row).encode(),config,'f'*64,witness),row)


class CollectorControls(unittest.TestCase):
    fixture=canonical.StartupAttachmentTests.fixture
    png=canonical.StartupAttachmentTests.png
    tool=canonical.StartupAttachmentTests.tool

    def payload(self):
        config,hashed,witness,ordinary=self.fixture('configuredLocal')
        row={key:config[key] for key in ['source_sha','test_source_sha','harness_sha','startup_source_sha256']}
        row.update({key:witness[key] for key in ['app_pid','app_launch_epoch','window_number']})
        row.update(schema='nac342-ax-client-rejection-v1',acceptance=False,scenario='configuredLocal',
            configuration_sha256=hashed,helper_sha256=config['ax_witness']['helper_sha256'],
            gate='receipt_status_not_ready',guard_site='initial_guard',client_phase='begin',receipt_status='refused',
            refusal_stage='sample_deadline',reader_terminal='absent',sequence='1',refusal_generation='0',
            began_ns='1',ended_ns='2',case_deadline_ns='10',failure_payload_present=False,observation_present=True)
        return config,hashed,witness,ordinary,json.dumps(row).encode()

    def failed(self,root,config,hashed,witness,rows,**kwargs):
        with self.assertRaisesRegex(RuntimeError,'cleanup_missing'):
            collect(self.tool(root,rows,result='Failed',**kwargs),root/'unit.xcresult',config,hashed,witness,root/'selected')
        index=json.loads((root/'selected/index.json').read_text())
        self.assertFalse(index['complete']);self.assertTrue(index['input_completion_unknown'])
        self.assertEqual(index['collection_error']['reason'],'cleanup_missing')
        return index

    def test_nil_failure_data_is_retained_before_original_mandatory_failure(self):
        config,hashed,witness,_,data=self.payload()
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);index=self.failed(root,config,hashed,witness,[(diagnostic.NAME,data)])
            self.assertEqual(index['client_rejection']['retention'],'retained')
            dest=root/'selected'/(diagnostic.NAME+'.json')
            self.assertEqual(dest.read_bytes(),data);self.assertEqual(dest.stat().st_mode&0o777,0o600)
            self.assertEqual(index['client_rejection']['sha256'],diagnostic.digest(data))
            self.assertEqual(index['ax_refusal']['retention'],'missing')

    def test_optional_cannot_complete_passed_or_failed_canonical_case(self):
        config,hashed,witness,ordinary,data=self.payload()
        for result,reason in [('Passed','unexpected_client_rejection'),('Failed','actual_test_result')]:
            with self.subTest(result=result),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary)
                with self.assertRaisesRegex(RuntimeError,reason):
                    collect(self.tool(root,ordinary+[(diagnostic.NAME,data)],result=result),root/'case.xcresult',config,hashed,witness,root/'selected')
                index=json.loads((root/'selected/index.json').read_text());self.assertFalse(index['complete'])
                self.assertEqual(index['client_rejection']['retention'],'rejected' if result=='Passed' else 'retained')

    def test_bad_inventory_payload_or_missing_optional_preserves_mandatory_error(self):
        config,hashed,witness,_,data=self.payload()
        def alias(export,manifest):
            manifest[0]['attachments'].append(dict(manifest[0]['attachments'][0]))
        def symlink(export,manifest):
            file=export/manifest[0]['attachments'][0]['exportedFileName'];target=export/'other';file.rename(target);file.symlink_to(target)
        def hardlink(export,manifest):
            file=export/manifest[0]['attachments'][0]['exportedFileName'];os.link(file,export/'other')
        def directory(export,manifest):
            file=export/manifest[0]['attachments'][0]['exportedFileName'];file.unlink();file.mkdir()
        def fifo(export,manifest):
            file=export/manifest[0]['attachments'][0]['exportedFileName'];file.unlink();os.mkfifo(file)
        for mutation,payload in [(None,data+b' '*2049),(None,b'{"private":"PRIVATE"}'),
                                 (alias,data),(symlink,data),(hardlink,data),(directory,data),(fifo,data)]:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);index=self.failed(root,config,hashed,witness,[(diagnostic.NAME,payload)],mutate=mutation)
                self.assertNotEqual(index['client_rejection']['retention'],'retained')
                self.assertFalse((root/'selected'/(diagnostic.NAME+'.json')).exists())
                self.assertNotIn('PRIVATE',json.dumps(index))
        with tempfile.TemporaryDirectory() as temporary:
            index=self.failed(Path(temporary),config,hashed,witness,[])
            self.assertEqual(index['client_rejection']['retention'],'missing')

    def test_destination_collision_permission_and_partial_write_do_not_mask_primary(self):
        config,hashed,witness,_,data=self.payload()
        for mode in ['collision','permission','partial']:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);source=root/'payload';source.write_bytes(data);output=root/'output';output.mkdir()
                dest=output/(diagnostic.NAME+'.json');index={'client_rejection':{'retention':'missing'},'selection_errors':[],
                    'actual_test':{'result':'Failed'}}
                selected=[(source,diagnostic.NAME,'client_rejection')];entries=[{'suggestedHumanReadableName':diagnostic.NAME}]
                original_open=os.open;original_fdopen=os.fdopen
                class Short:
                    def __init__(self,stream):self.stream=stream
                    def __enter__(self):return self
                    def __exit__(self,*args):self.stream.close()
                    def write(self,body):return self.stream.write(body[:1])
                def opening(path,*args,**kwargs):
                    if Path(path)==dest and mode=='permission':raise PermissionError('PRIVATE')
                    return original_open(path,*args,**kwargs)
                def fdopen(fd,how):
                    stream=original_fdopen(fd,how)
                    return Short(stream) if mode=='partial' and how=='wb' else stream
                if mode=='collision':dest.write_bytes(b'UNCHANGED')
                with patch.object(diagnostic.os,'open',side_effect=opening),patch.object(diagnostic.os,'fdopen',side_effect=fdopen):
                    self.assertEqual(diagnostic.retain(selected,entries,index,config,hashed,witness,output,True),0)
                self.assertEqual(index['client_rejection']['retention'],'rejected')
                self.assertNotIn('PRIVATE',json.dumps(index))
                if mode=='collision':self.assertEqual(dest.read_bytes(),b'UNCHANGED')
                else:self.assertFalse(dest.exists())


    def test_existing_bounded_reader_budget_checks_and_fd_closure_are_preserved(self):
        config,hashed,witness,_,data=self.payload()
        for fail_on in [1,2]:
            with self.subTest(fail_on=fail_on),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);source=root/'payload';source.write_bytes(data);output=root/'output';output.mkdir()
                index={'client_rejection':{'retention':'missing'},'selection_errors':[],'actual_test':{'result':'Failed'}}
                calls=[];streams=[];original=os.fdopen
                def checked():
                    calls.append(True)
                    if len(calls)==fail_on:raise TimeoutError('original budget latch')
                def fdopen(*args,**kwargs):
                    stream=original(*args,**kwargs);streams.append(stream);return stream
                with patch.object(diagnostic,'budget_check',side_effect=checked),patch.object(diagnostic.os,'fdopen',side_effect=fdopen):
                    self.assertEqual(diagnostic.retain([(source,diagnostic.NAME,'client_rejection')],
                        [{'suggestedHumanReadableName':diagnostic.NAME}],index,config,hashed,witness,output,True),0)
                self.assertEqual(len(calls),fail_on)
                self.assertTrue(all(stream.closed for stream in streams))
                self.assertFalse((output/(diagnostic.NAME+'.json')).exists())
                self.assertEqual(index['client_rejection']['retention'],'rejected')
