"""Pure adapter/project/custody controls. No SDK, process, app or GUI probes."""
from contextlib import contextmanager
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

import ci_paths
from ci_paths_protocol import CASES, HELPER, PRODUCT
from ci_paths_attachments import CAPTURES, validate_payloads
from ci_qualifications import select_target
from ci_support import export_evidence, MAX_TOTAL
from ci_xctest import require_generated_runner
from ci_xctest_project import (NATIVE, PROJECT, SCHEME, materialize_project)
import test_ci_paths_protocol as phase_fixtures
import test_ci_startup_attachments as image_fixtures


class AdapterControls(unittest.TestCase):
    def test_swift_observer_and_python_selector_bind_same_product(self):
        observer = Path(__file__).resolve().parent / 'NativeUITests/PathPhaseObserver.swift'
        pins = re.findall(r'static let product = "([0-9a-f]{40})"', observer.read_text())
        self.assertEqual(pins, [PRODUCT])
        self.assertEqual(select_target('all-347-paths-macos26')['source_sha'], PRODUCT)

    def test_fixed_selector_cannot_change_product_helper_order_or_retry(self):
        target = select_target('all-347-paths-macos26')
        self.assertEqual({k: target[k] for k in ci_paths.TARGET}, ci_paths.TARGET)
        for changes in ({'source_sha':'0'*40},
                        {'source_sha':'acbfc63aa2399cff3d34ec5f947a5e86a914b323'},
                        {'source_sha':'476d30089ed2f422da0b335c9bafa8b0fa9b3bf2'},
                        {'source_sha':'28502c9b40a09d48182375d8cbe4317becaa9456'},
                        {'source_sha':'a7046174f130727aa3bbc38fc405278073c4d4a7'},
                        {'helper_sha256':'0'*64}, {'retry_budget':1},
                        {'scenarios':list(reversed(CASES))}, {'scenario_count':3}):
            with self.subTest(changes=changes), patch.object(Path, 'read_text', return_value=json.dumps({
                'all-347-paths-macos26': {**ci_paths.TARGET, **changes}})), self.assertRaises(RuntimeError):
                select_target('all-347-paths-macos26')

    def test_allocation_exact_source_clock_and_exclusive_one_invocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary).resolve() / 'allocation.json'
            value = dict(version=1, H='a'*40, T=PRODUCT, cases=list(CASES), source_preflight=True,
                         native_eligibility=True, allocation_id='synthetic-unit-only',
                         started_at_epoch=1000, deadline_epoch=3340, retry_budget=0)
            variants = ({'H':'b'*40}, {'T':'b'*40},
                        {'T':'acbfc63aa2399cff3d34ec5f947a5e86a914b323'},
                        {'T':'476d30089ed2f422da0b335c9bafa8b0fa9b3bf2'},
                        {'T':'28502c9b40a09d48182375d8cbe4317becaa9456'},
                        {'T':'a7046174f130727aa3bbc38fc405278073c4d4a7'},
                        {'cases':list(reversed(CASES))},
                        {'source_preflight':False}, {'native_eligibility':False}, {'retry_budget':1},
                        {'started_at_epoch':2100}, {'deadline_epoch':2000}, {'deadline_epoch':9999})
            for changes in variants:
                path.write_text(json.dumps({**value, **changes}))
                with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                    ci_paths.require_allocation(path, 'a'*40, now=2000, environment={})
                self.assertFalse(path.with_name(path.name+'.consumed').exists())
            path.write_text(json.dumps(value))
            self.assertEqual(ci_paths.require_allocation(path, 'a'*40, now=2000, environment={}), value)
            with self.assertRaises(FileExistsError): ci_paths.require_allocation(path, 'a'*40, now=2001, environment={})

    def test_project_references_actual_three_sources_and_defines_helper_condition_without_copying(self):
        maintained = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve(); h, t = root/'H', root/'T'
            h.mkdir(); t.mkdir()
            for relative in (PROJECT/'project.pbxproj', PROJECT/SCHEME, NATIVE,
                             Path('desktop/macos/NativeUITests/PathJourneys.swift'),
                             Path('desktop/macos/NativeUITests/PathPhaseObserver.swift')):
                dest=h/relative;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((maintained/relative).read_bytes())
            helper=t/'desktop/macos/NativePathJourney.swift';helper.parent.mkdir(parents=True)
            helper.write_text('// Synthetic helper compiler-input fixture; never native evidence.\n')
            helper_hash=hashlib.sha256(helper.read_bytes()).hexdigest()
            self.enterContext(patch('ci_paths_protocol.HELPER', helper_hash))
            with patch('ci_xctest_project.checkout', side_effect=lambda root, sha: Path(root)), \
                    patch('ci_xctest_project.require_checkout'):
                selection=materialize_project(h,'a'*40,paths_root=t,paths_sha=PRODUCT,output=root/'selection')
                with self.assertRaisesRegex(RuntimeError,'mutually exclusive'):
                    materialize_project(h,'a'*40,paths_root=t,paths_sha=PRODUCT,startup_root=t)
            project=Path(selection['project']);text=(project/'project.pbxproj').read_text()
            for source in (h/NATIVE, h/'desktop/macos/NativeUITests/PathJourneys.swift',
                           h/'desktop/macos/NativeUITests/PathPhaseObserver.swift', helper):
                self.assertIn('path = "'+str(source)+'";',text)
            self.assertIn('files = (B10000000000000000000009, C10000000000000000000002, C10000000000000000000004);',text)
            self.assertEqual(text.count('"DEBUG NATIVE_UI_TESTS"'),1)
            self.assertEqual(text.count('isa = PBXFileReference;'),6)
            self.assertEqual(selection['receipt']['expected_target'],'NACPathUITests')
            self.assertEqual(len(selection['receipt']['sources']),4)
            self.assertFalse(list((root/'selection').rglob('*.swift')))
            tree=ET.parse(project/SCHEME.parent/'NACPathUITests.xcscheme')
            test=tree.find('.//TestableReference/BuildableReference')
            self.assertEqual(test.attrib['BlueprintName'],'NACPathUITests')
            self.assertEqual(test.attrib['BlueprintIdentifier'],'B10000000000000000000004')
            self.assertEqual(test.attrib['ReferencedContainer'],'container:NACNativeUITests.xcodeproj')
            env={'NAC_UI_FIXTURE':'/unit/config.json', 'NAC_PATH_SOURCE_PATH':selection['receipt']['path_source_path'],
                 'NAC_PATH_SOURCE_SHA256':selection['receipt']['path_source_sha256'],
                 'NAC_PATH_HARNESS_SHA':'a'*40,'NAC_PATH_CONFIGURATION_SHA256':'f'*64}
            target=dict(IsUITestBundle=True,BlueprintName='NACPathUITests',EnvironmentVariables=env,TestBundlePath='/unit/NACPathUITests.xctest')
            require_generated_runner({'one':target},Path('/unit/config.json'),'NACPathUITests',project_selection=selection['receipt'],paths_binding=dict(harness_sha='a'*40,configuration_sha256='f'*64))
            for field in ('NAC_PATH_SOURCE_PATH','NAC_PATH_SOURCE_SHA256','NAC_UI_FIXTURE','NAC_PATH_HARNESS_SHA','NAC_PATH_CONFIGURATION_SHA256'):
                changed=copy.deepcopy(target);changed['EnvironmentVariables'][field]='foreign'
                with self.subTest(field=field),self.assertRaises(RuntimeError):
                    require_generated_runner({'one':changed},Path('/unit/config.json'),'NACPathUITests',project_selection=selection['receipt'],paths_binding=dict(harness_sha='a'*40,configuration_sha256='f'*64))

    def test_cleanup_missing_or_foreign_proof_retains_roots_and_existing_owner_settles_exact_record(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary).resolve();parent=folder/'app-evidence';parent.mkdir(mode=0o700)
            evidence=parent/'app.json';scope=phase_fixtures.PhaseControls().scope();rows=phase_fixtures.PhaseControls().phases()
            evidence.write_text(json.dumps(dict(app_pid=scope['app_pid'],engine_pid=scope['engine_pid'],paths_phase=rows[0])))
            called=[]
            with self.assertRaisesRegex(RuntimeError,'custody proof'):
                ci_paths.settle_case(evidence,folder/'app',None,called.append)
            self.assertEqual(called,[])
            with self.assertRaisesRegex(RuntimeError,'changed'):
                ci_paths.settle_case(evidence,folder/'app',dict(scope={**scope,'app_pid':99},history=rows[:1],inputs=[{}]),called.append)
            with patch('ci_paths.require_settled') as settled:
                proof=ci_paths.settle_case(evidence,folder/'app',dict(scope=scope,history=rows[:1],inputs=[{}]),called.append)
            self.assertTrue(proof['app_engine_settled']);settled.assert_called_once()
            self.assertEqual(called,[folder/'cleanup'])
            recovery=json.loads((called[0]/'evidence/app.json').read_text())
            self.assertEqual(recovery['relocated_app'],str(folder/'app'))

    def test_essential_valid_json_survives_later_export_failure_and_png_bytes_are_original(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);raw=folder/'raw';raw.mkdir();output=folder/'out'
            essential=raw/'essential.json';essential.write_text('{"cleanup":"retained","source":"exact"}\n')
            large=raw/'z-verbose.json';large.write_bytes(b' '* (256*1024+1))
            with self.assertRaisesRegex(RuntimeError,'JSON exceeds'):
                export_evidence(raw,output,[],strict_json=True,essential_first=True,include_hashes=True)
            self.assertEqual(json.loads((output/'essential.json').read_text())['cleanup'],'retained')
            self.assertEqual(len(json.loads((output/'export.json').read_text())),1)
            self.assertFalse((output/'z-verbose.json').exists())
            large.unlink();png=image_fixtures.StartupAttachmentTests().png();(raw/'original.png').write_bytes(png)
            export_evidence(raw,folder/'second',[],strict_json=True,essential_first=True)
            self.assertEqual((folder/'second/original.png').read_bytes(),png)
            self.assertLess(len(png),2*1024*1024)

    def test_owned_wrapper_has_two_actual_helper_calls_and_no_finder_input_or_phase_cli(self):
        root=Path(__file__).resolve().parent
        source=(root/'NativeUITests/PathJourneys.swift').read_text()
        self.assertIn('NativePathJourney.folderSelection(',source)
        self.assertIn('NativePathJourney.pendingEngineFailure(',source)
        self.assertEqual(source.count('observePhase: observe, authorize: authorize'),2)
        self.assertIn('["--smoke-output", output.path, "--smoke-scenario", scenario]',source)
        self.assertNotIn('--phase',source)
        self.assertNotIn('finder.activate',source);self.assertNotIn('finder.terminate',source)
        self.assertIn('proc_pidinfo',source);self.assertIn('running.launchDate == date',source)
        observer=(root/'NativeUITests/PathPhaseObserver.swift').read_text()
        for anchor in ('O_NOFOLLOW','O_NONBLOCK','openat(','UniqueJSON.check','Same sequence mutation',
                       'Skipped or backward phase','Unexpected document replacement'):
            self.assertIn(anchor,observer)


class AttachmentControls(unittest.TestCase):
    def payloads(self,scenario):
        index=CASES.index(scenario);fixture=phase_fixtures.PhaseControls();scope=fixture.scope(('select-reload-create-reveal','pending-engine-failure')[index])
        history=fixture.phases(scope['operation']);config=dict(scenario=scenario,product_sha=PRODUCT,harness_sha='a'*40,helper_sha256=HELPER,native_sha256='b'*64,engine_sha256='c'*64)
        ch='d'*64;png=image_fixtures.StartupAttachmentTests().png();values={}
        controller=dict(schema='nac347-controller-v1',scenario=scenario,configuration_sha256=ch,inputs=1,
                        history=history,captures=list(CAPTURES[index]),capture_bytes=len(png)*len(CAPTURES[index]))
        values['nac347-controller']=json.dumps(controller).encode()
        values['nac347-input-001']=json.dumps(dict(schema='nac347-input-v1',index=1,configuration_sha256=ch,
            authorization_policy_unchanged=True,app_pid=scope['app_pid'],window=scope['window'],run=scope['run'],
            sequence=0,phase='ready',document=scope['document'],engine_start=[scope['engine_pid'],1000,25],app_launch_epoch=999.5)).encode()
        for name in CAPTURES[index]:
            seq={'chooser-unicode':0,'reloaded-form':1,'moved-folder-error':3,'session-files':3,'finder-selected':4,'failure-panel':0}[name]
            phase=history[seq]
            caption=dict(schema='nac347-capture-v1',name=name,configuration_sha256=ch,H=config['harness_sha'],T=PRODUCT,
                         **{k:config[k] for k in ('native_sha256','engine_sha256','helper_sha256')},png_sha256=hashlib.sha256(png).hexdigest(),
                         **{k:phase[k] for k in ('app_pid','window','run','launch','view','document')},sequence=seq,phase=phase['name'])
            values['nac347-'+name]=png;values['nac347-caption-'+name]=json.dumps(caption).encode()
        if scenario == CASES[0]:
            for stage,seq in (('before',3),('after',4)):
                windows=[] if stage=='before' else [dict(index=0,owned_title=True,leaf_count=1,selected_leaf_count=1)]
                values['nac347-finder-'+stage]=json.dumps(dict(schema='nac347-finder-v1',stage=stage,
                    configuration_sha256=ch,H=config['harness_sha'],T=PRODUCT,close_authority=False,phase=history[seq],
                    folder='Folder with spaces 日本語 '+scope['run'],leaf='reveal me 日本語 '+scope['run'],windows=windows)).encode()
        return values,config,ch

    def test_both_finite_actual_payload_schemas_retain_original_png_identity(self):
        for scenario in CASES:
            values,config,ch=self.payloads(scenario);proof=validate_payloads(values,config,ch,passing=True)
            self.assertTrue(proof['complete']);self.assertTrue(proof['actual_image_review_required'])
            self.assertEqual(len(proof['images']),len(CAPTURES[CASES.index(scenario)]))

    def test_wrong_source_hash_capture_phase_or_missing_original_cannot_pass(self):
        values,config,ch=self.payloads(CASES[0])
        for key in ('H','T','helper_sha256','native_sha256','engine_sha256','png_sha256','document','sequence'):
            changed=dict(values);caption=json.loads(changed['nac347-caption-chooser-unicode']);caption[key]=9 if key=='sequence' else 'foreign'
            changed['nac347-caption-chooser-unicode']=json.dumps(caption).encode()
            with self.subTest(key=key),self.assertRaises(RuntimeError):validate_payloads(changed,config,ch,passing=True)
        for name in ('nac347-chooser-unicode','nac347-input-001','nac347-controller'):
            changed=dict(values);changed.pop(name)
            with self.subTest(name=name),self.assertRaises((RuntimeError,KeyError)):validate_payloads(changed,config,ch,passing=True)
        changed=dict(values);changed['nac347-finder-selected']=b'not a PNG'
        with self.assertRaises(RuntimeError):validate_payloads(changed,config,ch,passing=True)


    def test_finder_baseline_foreign_selection_replay_and_close_authority_never_pass(self):
        values,config,ch=self.payloads(CASES[0])
        changes=[('before',{'windows':[dict(index=0,owned_title=True,leaf_count=0,selected_leaf_count=0)]}),
                 ('after',{'windows':[]}),('after',{'close_authority':True}),
                 ('after',{'leaf':'foreign'}),('after',{'T':'0'*40}),('after',{'phase':{}})]
        for stage,fields in changes:
            changed=dict(values);key='nac347-finder-'+stage
            row=json.loads(changed[key]);row.update(fields);changed[key]=json.dumps(row).encode()
            with self.subTest(stage=stage,fields=fields),self.assertRaises(RuntimeError):
                validate_payloads(changed,config,ch,passing=True)


if __name__ == '__main__': unittest.main()
