"""Actual closed role/case/evidence controls; inert ports and current source."""
import ast
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import test_four_startup as full
import test_launch as launcher

controller, budget = full.controller, full.budget
PAIR = json.loads((full.HERE / 'configured-refusal-pair.json').read_bytes())


class RefusalControls(unittest.TestCase):
    setUp = full.SourceControls.setUp
    admission = full.SourceControls.admission
    advance = full.SourceControls.advance
    def test_closed_admission_cannot_reuse_full_or_legacy_scope(self):
        value = self.admission(); value['scope'] = controller.REFUSAL_SCOPE
        self.assertEqual(controller.admit(value, 'a'*40, now=1001, configured_refusal=True), (1000,3880,4480,4600))
        for change in ({'scope': controller.SCOPE}, {'attempt':2}, {'retries':1},
                       {'manifest_sha256':'0'*64}, {'producer':{**value['producer'],'artifact_id':1}}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                controller.admit({**value,**change},'a'*40,now=1001,configured_refusal=True)
        with self.assertRaises(RuntimeError): controller.admit(value,'a'*40,now=1001)
        self.assertEqual(PAIR['H'], controller.REFUSAL_H)
        self.assertNotIn('R', PAIR)

    def test_H148_nomination_rejects_old_scope_branch_and_H(self):
        self.assertEqual(controller.REFUSAL_H, '148f51f887a823bbc517e34aa607615393aa2875')
        contract=json.loads((full.HERE/'configured-refusal-contract.json').read_bytes())
        self.assertEqual(contract['H'],PAIR['H']);self.assertEqual(contract['scope'],controller.REFUSAL_SCOPE)
        self.assertEqual(contract['dispatch']['experimental_branch'],controller.REFUSAL_BRANCH.removeprefix('refs/heads/'))
        value=self.admission();value['scope']=controller.REFUSAL_SCOPE
        for old_scope in ('P12-Qba-Hebdb-configured-refusal-diagnostic01',controller.SCOPE):
            with self.assertRaises(RuntimeError):
                controller.admit({**value,'scope':old_scope},'a'*40,now=1001,configured_refusal=True)
        env=dict(ROOT_STARTUP_ADMISSION=json.dumps(value),GITHUB_SHA='a'*40,
            GITHUB_REF='refs/heads/codex/experimental-native-p12-configured-refusal-consumer01',
            GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_RUN_ATTEMPT='1',GITHUB_REPOSITORY='arcee-ai/nac')
        with patch.dict(launcher.launch.os.environ,env),patch.object(launcher.launch.time,'time',return_value=1001):
            with self.assertRaises(RuntimeError):launcher.launch.inputs(configured_refusal=True)
        main=next(n for n in ast.parse((full.HERE/'four-startup.py').read_bytes()).body
            if isinstance(n,ast.FunctionDef) and n.name=='main')
        gate=next(n for n in main.body if isinstance(n,ast.If) and isinstance(n.test,ast.Name)
                  and n.test.id=='configured_refusal')
        code=compile(ast.Module(body=[gate],type_ignores=[]),'<actual-H-pin-gate>','exec')
        for field,bad in (('H','ebdbd340bdc1220318446180c0a0df579489392c'),('H','0'*40),('P','0'*40),('Q','0'*40)):
            ns=dict(controller.__dict__,configured_refusal=True,pair={**PAIR,field:bad})
            with self.assertRaises(RuntimeError):exec(code,ns)
        exec(code,dict(controller.__dict__,configured_refusal=True,pair=PAIR))

    def proof(self):
        return dict(scenario='configuredLocal',H=PAIR['H'],P=PAIR['P'],Q=PAIR['Q'],passed=False,
            public_test_requested=True,input_completion_unknown=True,rendered_UI_reload_observed=False,errors={},
            owner_observation=dict(failure='app_windows',ui_failure='app_windows',process_failure=None,
                positive_process_settlement=True,metadata_helper_settled=True,positive_settlement=False,original_window_number=17),
            cleanup=dict(owned_processes_settled=True,complete_observation=True),
            ax_companion_custody=dict(owned_processes_settled=True),profile_removed=True,
            persistent_authorization_policy_unchanged=True,integrity={},provider={},actual_result={},
            ax_companion_diagnostic=dict(acceptance=False,stage='lifetime',code='ownership_invalid',refusal_generation='0',
                binding=dict(harness_sha=PAIR['H'],source_sha=PAIR['P'],test_source_sha=PAIR['Q']),
                pre_refusal_paired=dict(schema='nac342-ax-pre-refusal-paired-v1',acceptance=False,cg_window_count=2,
                    cg_window_ids=[17,18],cg_ids_truncated=False,original_window_number=17,outcome='reader_refused',closing_valid=True)))

    def exercise_refusal(self, change=None, export_failure=False, returned=False):
        proof = self.proof()
        if change: change(proof)
        primary = RuntimeError('inert original maintained UI refusal')
        progress, validations = [], []
        with tempfile.TemporaryDirectory(prefix='nac-refusal-role-inert-') as temp:
            root=Path(temp);folder=root/'startup-configuredLocal';folder.mkdir()
            (folder/'case.json').write_text(json.dumps(proof))
            startup=Mock(spec=['CASES','run_case']);startup.CASES=controller.CASES
            if not returned: startup.run_case.side_effect=primary
            def publish(**updates):
                progress.append(updates)
                if export_failure and 'diagnostic' in updates: raise OSError('inert evidence sink fault')
            def validate(value):
                validations.append(value)
                self.assertIs(value['acceptance'], False)
                source=subprocess.check_output(['git','show',PAIR['H']+':desktop/macos/ci_startup_ax.py'])
                tree=ast.parse(source);functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('require','paired_diagnostic')]
                namespace={};exec(compile(ast.Module(body=functions,type_ignores=[]),'<actual-H-pair-parser>','exec'),namespace)
                return namespace['paired_diagnostic'](value)
            with self.assertRaises(RuntimeError) as raised:
                controller.selected_refusal(startup,self.clock,budget.using,evidence=root,profiles=root/'profiles',
                    app='original-normal-app',manifest='original-normal-manifest',product='exact-P12',tests='exact-Qba',
                    selection={},observer='exact-H',image_reader='exact-image',run=Mock(),command=Mock(),
                    native_report=Mock(),progress=publish,read=lambda path,limit:path.read_bytes(),validate_pair=validate)
            if not returned:self.assertIs(raised.exception,primary)
            startup.run_case.assert_called_once()
            self.assertEqual(startup.run_case.call_args.kwargs['scenario'],'configuredLocal')
            self.assertEqual(startup.run_case.call_args.kwargs['harness_sha'],PAIR['H'])
            self.assertEqual(progress[0],dict(requested='configuredLocal'))
            self.assertTrue(self.clock.failed);self.assertTrue(self.clock.cleaning)
            for update in progress[1:]:self.assertIs(update['diagnostic']['acceptance'],False)
            return progress, validations

    def test_one_case_refusal_and_positive_cleanup_still_raises_original_false_acceptance(self):
        progress,validated=self.exercise_refusal()
        self.assertEqual(progress[-1]['diagnostic']['status'],'BOUNDED_REFUSAL_AND_CLEANUP')
        self.assertEqual(len(validated),1)
        self.assertIs(progress[-1]['diagnostic']['independent_R_executed'],False)

    def test_unknown_cleanup_source_or_prior_refusal_never_completes_diagnostic(self):
        for change in (lambda p:p.update(profile_removed=False),lambda p:p['cleanup'].update(owned_processes_settled=False),
                       lambda p:p['owner_observation'].update(process_failure='unknown'),
                       lambda p:p['owner_observation'].update(metadata_helper_settled=False),
                       lambda p:p['ax_companion_custody'].update(owned_processes_settled=False),
                       lambda p:p.update(H='0'*40),lambda p:p['ax_companion_diagnostic'].update(refusal_generation='1')):
            self.setUp()
            progress,validated=self.exercise_refusal(change)
            self.assertEqual(progress[-1]['diagnostic']['status'],'INCOMPLETE');self.assertEqual(validated,[])

    def test_export_failure_and_unexpected_success_never_clear_refusal_or_accept(self):
        self.exercise_refusal(export_failure=True)
        self.setUp(); self.exercise_refusal(returned=True)

    def test_diagnostic_launcher_omits_R_but_reuses_exact_artifact_validation(self):
        value=self.admission();value['scope']=controller.REFUSAL_SCOPE
        self.assertEqual(launcher.launch.minutes(value,'checkout-H',now=1001,configured_refusal=True),2)
        with self.assertRaises(RuntimeError):launcher.launch.minutes(value,'checkout-R',now=1001,configured_refusal=True)
        env=dict(ROOT_STARTUP_ADMISSION=json.dumps(value),GITHUB_SHA='a'*40,GITHUB_REF=controller.REFUSAL_BRANCH,
            GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_RUN_ATTEMPT='1',GITHUB_REPOSITORY='arcee-ai/nac')
        with patch.dict(launcher.launch.os.environ,env),patch.object(launcher.launch.time,'time',return_value=1001):
            self.assertEqual(launcher.launch.inputs(configured_refusal=True),value)
            with self.assertRaises(RuntimeError):launcher.launch.inputs()
        source=(full.HERE/'configured-refusal-launch.py').read_text()
        self.assertIn('owner.main(configured_refusal=True)',source)
        self.assertIn("'launch.py'",source)

    def test_default_full_episode_and_workflow_source_are_preserved(self):
        old=subprocess.check_output(['git','show','ec8076b99105737e7a0a0e86d61d84705a155eab:.github/scripts/native342-startup/four-startup.py'],text=True)
        def selected(source):
            tree=ast.parse(source);return ast.dump(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='selected_episode'))
        self.assertEqual(selected(old),selected((full.HERE/'four-startup.py').read_text()))
        workflow=full.repository/'.github/workflows/stable-release.yml'
        original_workflow=subprocess.check_output(['git','show','ec8076b99105737e7a0a0e86d61d84705a155eab:.github/workflows/stable-release.yml'])
        self.assertIn(b'  four_startup:',original_workflow)
        self.assertIn('  configured_refusal:',workflow.read_text())
        contract=json.loads((full.HERE/'configured-refusal-contract.json').read_bytes())
        self.assertIs(contract['runtime_authorized'],False);self.assertIs(contract['acceptance'],False)
        self.assertEqual(contract['cases'],['configuredLocal'])
        self.assertIs(contract['fresh_R_acceptance'],False)

    def test_actual_diagnostic_finalizer_keeps_primary_through_export_fault(self):
        import sys
        tree=ast.parse((full.HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        outer=next(n for n in main.body if isinstance(n,ast.Try))
        body=[ast.Raise(exc=ast.Name(id='original',ctx=ast.Load()))]
        code=compile(ast.fix_missing_locations(ast.Module(body=[ast.Try(body=body,handlers=outer.handlers,
            orelse=[],finalbody=outer.finalbody)],type_ignores=[])),'<actual-diagnostic-finalization>','exec')
        for failed_export in (False,True):
            self.setUp()
            with tempfile.TemporaryDirectory(prefix='nac-refusal-finalizer-inert-') as temp:
                root=Path(temp);raw=root/'raw';raw.mkdir();exported=root/'exported';exported.mkdir()
                original=RuntimeError('inert original CG refusal')
                report=dict(status='FAIL',acceptance=False,package_before={'exact':'normal P12'},
                    full_four_case_run=False,protocol_executed=False)
                startup=Mock();startup.package_contract.return_value=report['package_before']
                def save():controller.write(raw/'configured-refusal.json',report)
                def export(*args,**kwargs):
                    self.assertTrue(kwargs['strict_json']);self.assertTrue(kwargs['include_hashes'])
                    if failed_export:raise OSError('inert exporter fault')
                    controller.write(exported/'configured-refusal.json',report)
                ns=dict(original=original,configured_refusal=True,sys=sys,clock=self.clock,using=budget.using,
                    report=report,console=Mock(return_value={}),startup=startup,contract=object(),
                    manifest=root/'manifest',app=root/'app',roots={k:root/k for k in ('H','P','Q')},pair=PAIR,
                    evidence=raw,run=Mock(),require=controller.require,require_checkout=Mock(),controller=root/'controller',
                    admission={'controller_sha':'a'*40},STOP=[],time=controller.time,save=save,export_evidence=export,
                    redact_values=lambda:[],package=root/'package',output=root,exported=exported)
                with self.assertRaises(RuntimeError) as raised:exec(code,ns)
                self.assertIs(raised.exception,original)
                self.assertIs(report['acceptance'],False);self.assertEqual(report['status'],'FAIL')
                startup.package_contract.assert_called_once()
                if failed_export:self.assertIsInstance(raised.exception.__cause__,OSError)
                else:self.assertIs(json.loads((exported/'configured-refusal.json').read_bytes())['acceptance'],False)

    def test_existing_H_exporter_retains_closed_paired_JSON_and_rejects_oversize(self):
        import sys
        previous=list(sys.path);sys.path.insert(0,str(full.H/'desktop/macos'))
        try:
            from ci_support import export_evidence, MAX_FILE
            with tempfile.TemporaryDirectory(prefix='nac-refusal-export-inert-') as temp:
                root=Path(temp);raw=root/'raw';raw.mkdir();out=root/'exported';out.mkdir()
                proof=self.proof();controller.write(raw/'configured-refusal.json',dict(acceptance=False,status='FAIL',case=proof))
                export_evidence(raw,out,[],include_hashes=True,strict_json=True,essential_first=True)
                self.assertEqual(json.loads((out/'configured-refusal.json').read_bytes())['case'],proof)
                entries=json.loads((out/'export.json').read_bytes())
                self.assertTrue(entries and all(row['truncated'] is False for row in entries))
                (raw/'zzz-oversize.json').write_text(json.dumps({'too_large':'x'*(MAX_FILE+1)}))
                with self.assertRaises(RuntimeError):export_evidence(raw,out,[],include_hashes=True,strict_json=True,essential_first=True)
                self.assertIs(json.loads((out/'configured-refusal.json').read_bytes())['acceptance'],False)
        finally:sys.path[:]=previous

    def test_actual_diagnostic_callback_denies_any_independent_R_command_before_owner(self):
        tree=ast.parse((full.HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        callbacks=[n for n in main.body if isinstance(n,ast.FunctionDef) and n.name in ('bound','run')]
        ci=Mock(spec=['run'])
        ns=dict(configured_refusal=True,clock=self.clock,active=budget.active,using=budget.using,ci=ci,
            roots={'H':full.H},report={'phases':[]},save=Mock(),time=controller.time,Path=Path,STOP=[],
            runtime_build_receipt=Mock(),require=controller.require,COMPLETE_LOG_LIMIT=2*1024*1024)
        exec(compile(ast.Module(body=callbacks,type_ignores=[]),'<actual-diagnostic-run-gate>','exec'),ns)
        with self.assertRaises(RuntimeError):ns['run'](['cargo','test','--locked'],Path('/inert-R'),900)
        ci.run.assert_not_called()
        with self.assertRaises(RuntimeError):ns['run'](['inert'],Path('/inert-R'),900,complete_output_limit=2*1024*1024)
        ci.run.assert_not_called()

    def callback_fault(self, *, configured=True, helper_error=None, final_save_error=None,
                       initial_save_error=None, receipt_error=None):
        tree=ast.parse((full.HERE/'four-startup.py').read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        callbacks=[n for n in main.body if isinstance(n,ast.FunctionDef) and n.name in ('bound','run')]
        ci=Mock(spec=['run']);ci.run.side_effect=helper_error
        save=Mock(side_effect=[initial_save_error] if initial_save_error is not None else [None,final_save_error])
        report={'phases':[]};receipt=Mock(side_effect=receipt_error)
        ns=dict(configured_refusal=configured,clock=self.clock,active=budget.active,using=budget.using,ci=ci,
            roots={'H':full.H},report=report,save=save,time=controller.time,Path=Path,STOP=[],
            runtime_build_receipt=receipt,require=controller.require,COMPLETE_LOG_LIMIT=2*1024*1024)
        exec(compile(ast.Module(body=callbacks,type_ignores=[]),'<actual-run-phase-save-fault>','exec'),ns)
        caught=None
        try:ns['run'](['xcodebuild','build-for-testing' if receipt_error else 'test-without-building'],Path('/inert-test.log'),300)
        except BaseException as error:caught=error
        return caught,report,ci,save

    def test_CFG_F2_exact_reviewer_helper_plus_final_save_fault_preserves_primary(self):
        primary=RuntimeError('inert actual helper failed from UI abort');sink=OSError('inert final phase evidence failure')
        caught,report,ci,save=self.callback_fault(helper_error=primary,final_save_error=sink)
        self.assertIs(caught,primary)
        self.assertIs(caught.__cause__,sink)
        self.assertTrue(report['phases'][0]['phase_save_failed'])
        self.assertEqual(report['phases'][0]['status'],'FAIL')
        ci.run.assert_called_once();self.assertEqual(save.call_count,2)

    def test_CFG_F1_uses_registered_entry_without_duplicate_yaml_or_bootstrap(self):
        contract=json.loads((full.HERE/'configured-refusal-contract.json').read_bytes())
        self.assertIn('dispatch',contract)
        self.assertEqual(contract['dispatch']['workflow_path'],'.github/workflows/stable-release.yml')
        self.assertEqual(contract['dispatch']['registered_workflow_id'],353798970)
        self.assertEqual(contract['dispatch']['full_controller_ref'],'ec8076b99105737e7a0a0e86d61d84705a155eab')
        self.assertFalse((full.repository/'.github/workflows/native342-configured-refusal.yml').exists())
        source=(full.repository/contract['dispatch']['workflow_path']).read_text()
        self.assertIn('  configured_refusal:',source)
        self.assertIn('experimental-native-p12-context-consumer01',source)
        self.assertIn('workflow_dispatch:',source)
        self.assertNotIn('  push:',source)

    def test_phase_save_success_helper_only_save_only_and_full_mode_neighbors(self):
        for configured in (True,False):
            for kind in ('success','helper-only','save-only','both','initial-save','receipt','receipt+save'):
                with self.subTest(configured=configured,kind=kind):
                    self.setUp()
                    primary=RuntimeError('inert helper primary') if kind in ('helper-only','both') else None
                    sink=OSError('inert phase save') if kind in ('save-only','both','receipt+save') else None
                    initial=OSError('inert initial phase save') if kind=='initial-save' else None
                    receipt=ValueError('inert actual SDK receipt') if kind in ('receipt','receipt+save') else None
                    caught,report,ci,save=self.callback_fault(configured=configured,helper_error=primary,
                        final_save_error=sink,initial_save_error=initial,receipt_error=receipt)
                    expected=initial or primary or receipt or sink
                    self.assertIs(caught,expected)
                    if initial is not None:
                        ci.run.assert_not_called();self.assertEqual(save.call_count,1)
                    else:
                        ci.run.assert_called_once();self.assertEqual(save.call_count,2)
                    if kind=='success':
                        self.assertEqual(report['phases'][0]['status'],'PASS');self.assertFalse(self.clock.failed)
                    if sink is not None:
                        self.assertTrue(report['phases'][0]['phase_save_failed'])
                        self.assertEqual(report['phases'][0]['status'],'FAIL');self.assertTrue(self.clock.cleaning)
                    if (primary is not None or receipt is not None) and sink is not None:self.assertIs(caught.__cause__,sink)

    def test_phase_save_preserves_pending_cancellation_and_does_not_mask_new_cancellation(self):
        import asyncio
        for configured in (True,False):
            for cancellation in (KeyboardInterrupt(),SystemExit(13),asyncio.CancelledError()):
                with self.subTest(configured=configured,cancellation=type(cancellation).__name__):
                    self.setUp();sink=OSError('inert final save fault during cancellation')
                    caught,report,ci,save=self.callback_fault(configured=configured,helper_error=cancellation,final_save_error=sink)
                    self.assertIs(caught,cancellation);self.assertIs(caught.__cause__,sink)
                    ci.run.assert_called_once();self.assertTrue(report['phases'][0]['phase_save_failed'])
                    self.setUp();primary=RuntimeError('inert earlier helper failure')
                    caught,_,ci,_=self.callback_fault(configured=configured,helper_error=primary,final_save_error=cancellation)
                    self.assertIs(caught,cancellation);ci.run.assert_called_once()
                    self.setUp()
                    caught,_,ci,_=self.callback_fault(configured=configured,final_save_error=cancellation)
                    self.assertIs(caught,cancellation);ci.run.assert_called_once()

    def test_phase_save_keeps_original_budget_failure_before_any_helper(self):
        self.advance(2880)
        sink=OSError('inert evidence save after original work cutoff')
        caught,report,ci,save=self.callback_fault(final_save_error=sink)
        self.assertIsInstance(caught,(RuntimeError,TimeoutError))
        self.assertIsNot(caught,sink);self.assertIs(caught.__cause__,sink)
        ci.run.assert_not_called();self.assertTrue(self.clock.failed)
        self.assertTrue(report['phases'][0]['phase_save_failed'])
