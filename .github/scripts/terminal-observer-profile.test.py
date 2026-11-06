#!/usr/bin/env python3
"""Offline preservation and numeric-budget controls; never runs Rust or the case."""
import hashlib
import importlib.util
import json
import os
import tomllib
from pathlib import Path
import re
import tempfile
import sys
sys.dont_write_bytecode=True
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('profile',Path(__file__).with_name('terminal-observer-profile.py'))
profile=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(profile)
PINS=json.loads(Path(__file__).with_name('terminal-observer-profile-baseline.json').read_text())


def tokens(text):
    # Preserve string contents while allowing formatter-only exterior whitespace.
    return ''.join(re.findall(r'"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[^\s]',text))


def projection(path,text):
    if path.endswith('harness.ts'):
        text=re.sub(r'// NAC PROFILE BEGIN\n.*?// NAC PROFILE END',
                    lambda m: 'if (testInfo.status === testInfo.expectedStatus) return;' if 'testInfo.status' in m[0] else '',text,flags=re.S)
    text=re.sub(r'[ \t]*// NAC PROFILE BEGIN\n.*?// NAC PROFILE END\n','',text,flags=re.S)
    if path.endswith('nacClient.ts'):
        text=text.replace('const decoded = (await response.json()) as T;','return (await response.json()) as T;').replace('    return decoded;\n','')
    if path.endswith('delivery/executions.rs'):
        text=text.replace('Result<axum::response::Response, ApiError>','Result<Json<ExecutionFrameResponse>, ApiError>')
        text=re.sub(r'let mapped = ExecutionFrameResponse::from_frame\(observer, frame\)\?;\s*let response = axum::response::IntoResponse::into_response\(Json\(mapped\)\);\s*Ok\(response\)',
                    'Ok(Json(ExecutionFrameResponse::from_frame(observer, frame)?))',text)
    return hashlib.sha256(tokens(text).encode()).hexdigest()


class Controls(unittest.TestCase):
    def test_reference_and_exact_case(self):
        self.assertEqual(PINS['base'],'02354e7b9c13404de6bb7a31381760db1003c8bc')
        self.assertEqual(profile.digest(ROOT/profile.E2E),profile.E2E_SHA)
        for path,digest in PINS['projection'].items():
            with self.subTest(path=path):self.assertEqual(projection(path,(ROOT/path).read_text()),digest)
        for path,digest in PINS['exact'].items():
            self.assertEqual(profile.digest(ROOT/path),digest)
    def test_projection_rejects_protocol_weakening(self):
        path='crates/nac-server/src/application/terminal_observation.rs';text=(ROOT/path).read_text()
        for old,new in [('wait_ms','wait_ms_changed'),('page.bytes.is_empty()','true'),('state.cursor','state.cursor + 1')]:
            self.assertIn(old,text);self.assertNotEqual(projection(path,text.replace(old,new)),PINS['projection'][path])
        path='crates/nac-server/web/packages/nac-client/src/userTerminalConnection.ts';text=(ROOT/path).read_text()
        self.assertNotEqual(projection(path,text.replace('await rendered(this.renderer.write', 'rendered(this.renderer.write')),PINS['projection'][path])
    def test_one_serialization_and_schema_contract(self):
        path='crates/nac-server/src/delivery/executions.rs';text=(ROOT/path).read_text()
        pull=text[text.index('pub(crate) async fn pull('):text.index('pub(crate) async fn detach(')] if 'pub(crate) async fn detach('in text else text[text.index('pub(crate) async fn pull('):text.index('#[utoipa::path(delete',text.index('pub(crate) async fn pull('))]
        self.assertEqual(pull.count('IntoResponse::into_response(Json(mapped))'),1)
        self.assertEqual(pull.count('ExecutionFrameResponse::from_frame(observer, frame)?'),1)
        self.assertEqual(pull.count('.await?'),1)
        self.assertNotIn('serde_json::to_',pull)
        self.assertEqual(projection(path,text),PINS['projection'][path])
    def test_numeric_shape_and_redaction(self):
        good=dict(schema=1,side='server',phase='status',seq=0,at_us=2,elapsed_us=1,observer='00000000-0000-0000-0000-000000000001',cursor='0')
        self.assertEqual(profile.numeric(good),good)
        for update in ({'schema':True},{'payload':'secret'},{'at_us':float('nan')},{'elapsed_us':-1},{'seq':2049},{'cursor':'01'},{'observer':'secret'},{'request':'token'},{'phase':'unbounded'},{'at_us':True}):
            with self.subTest(update=update),self.assertRaises((ValueError,TypeError)):profile.numeric(good|update)
        profile.numeric(dict(schema=1,side='client',phase='truncated',seq=2048))
        with self.assertRaises(ValueError):profile.numeric(dict(schema=1,side='client',phase='truncated',seq=1))
    def test_regular_nofollow_and_fresh_receipts(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);file=root/'file';profile.write(file,{'ok':True})
            self.assertEqual(profile.digest(file),hashlib.sha256(file.read_bytes()).hexdigest())
            with self.assertRaises(FileExistsError):profile.write(file,{})
            link=root/'link';link.symlink_to(file)
            with self.assertRaises(OSError):profile.regular(link)
            with self.assertRaises(ValueError):profile.size(root)
    def test_extract_bounded_numeric_only(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);out=root/'out';out.mkdir()
            (root/'browser-events.json').write_text(json.dumps([{'kind':'console','text':'unrelated payload'}, {'kind':'console','text':'NAC_TERMINAL_PHASE '+json.dumps(dict(schema=1,side='client',phase='truncated',seq=2048))}]))
            result=profile.capture_phases(root,out)
            self.assertEqual(result['counts'],{'client':1,'server':0});self.assertTrue(result['truncated'])
            self.assertNotIn('payload',(out/'phases.json').read_text())
    def test_existing_numeric_case_measurements_keep_values_without_payloads(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);out=root/'out';out.mkdir();raw=root/'raw';raw.mkdir()
            value={'measurements':{'interruptToRenderedMarkerMs':1743.1},'heartbeat':{'count':1,'maxGapMs':1.5,'last':1.2,'active':False},'pages':[{'bytes':32768,'gap':False,'retained':100000}],'maxFrameBytes':32768}
            file=raw/'pressure-observations.json';file.write_text(json.dumps(value))
            self.assertTrue(profile.pressure(raw,out)['present'])
            self.assertEqual(json.loads((out/'pressure-observations.json').read_text()),value)
            value['measurements']['payload']='secret';file.write_text(json.dumps(value))
            with self.assertRaises(ValueError):profile.pressure(raw,out)

    def test_large_runner_is_pinned_not_rejected_and_quota_is_reported(self):
        observed=iter(({2,3,4,5},{2,3}))
        with patch.object(profile.os,'sched_getaffinity',side_effect=lambda _pid:next(observed),create=True), \
             patch.object(profile.os,'sched_setaffinity',create=True)as setter, \
             patch.object(profile.os,'cpu_count',return_value=32), \
             patch.object(Path,'read_text',side_effect=OSError('unavailable')):
            value=profile.cpu_capacity()
        setter.assert_called_once_with(0,{2,3})
        self.assertEqual(value['host_visible_cpus'],32)
        self.assertEqual(value['affinity_selected'],[2,3])
        self.assertFalse(value['matched_failed_runtime'])
        self.assertIsNotNone(value['cgroup_observation_error'])
        with patch.object(profile.os,'sched_getaffinity',return_value={0},create=True):
            with self.assertRaises(ValueError):profile.cpu_capacity()

    def test_exact_case_selector_accepts_playwright_prefixed_title(self):
        selector=re.compile(r'(?:^| )'+re.escape(profile.CASE)+'$')
        self.assertIsNotNone(selector.search('terminal-local-acceptance.e2e.ts '+profile.CASE))
        self.assertIsNotNone(selector.search(profile.CASE))
        self.assertIsNone(selector.search(profile.CASE+' extra'))
        source=(ROOT/profile.E2E).read_text()
        self.assertEqual(source.count('test("'+profile.CASE+'"'),1)

    def test_native_admission_keeps_full_operation_and_cleanup_budget(self):
        with tempfile.TemporaryDirectory()as directory:
            obj=object.__new__(profile.Controller);obj.evidence=Path(directory);obj.stopped=False;obj.privileged=False;obj.deadline=2000
            with patch.object(profile.time,'time',return_value=799):obj.admit('root-native',900)
            self.assertTrue(json.loads((obj.evidence/'root-native-admission.json').read_text())['admitted'])
            with patch.object(profile.time,'time',return_value=801),self.assertRaisesRegex(ValueError,'budget-not-executed'):
                obj.admit('refuse-native',900)
            self.assertFalse(json.loads((obj.evidence/'refuse-native-admission.json').read_text())['admitted'])
            for label,budget in [('build',720),('case',180)]:
                with patch.object(profile.time,'time',return_value=2000-budget-299),self.assertRaises(ValueError):obj.admit(label,budget)
        text=(ROOT/'.github/scripts/terminal-observer-profile.py').read_text()
        self.assertIn("controller.native(apt,'apt-update'",text)
        self.assertIn("controller.native(apt,'browser-libraries'",text)
        self.assertIn("self.admit(label,900)",text)
        self.assertEqual(text.count('timeout=900)'),1)
        self.assertNotIn('timeout=180)',text)
        obj.privileged=True
        with self.assertRaises(InterruptedError):obj.stop(15,None)
        self.assertTrue(obj.stopped)

    def test_case_admission_refusal_never_spawns_or_becomes_case_failure(self):
        with tempfile.TemporaryDirectory()as directory:
            obj=object.__new__(profile.Controller);obj.evidence=Path(directory);obj.raw=Path(directory)/'raw'
            obj.raw.mkdir();obj.stopped=False;obj.deadline=2000
            result={'outcome':'case-started'}
            with patch.object(profile.time,'time',return_value=1521),patch.object(profile.subprocess,'Popen')as spawn:
                try:obj.run('case',['never-execute'],180)
                except profile.BudgetRefusal as error:profile.record_failure(result,error)
                else:self.fail('case should refuse before launch')
                spawn.assert_not_called()
            self.assertEqual(result['outcome'],'budget-not-executed/no-result')
            self.assertFalse(json.loads((obj.evidence/'case-admission.json').read_text())['admitted'])
            self.assertEqual(list(obj.raw.iterdir()),[])
            self.assertFalse((obj.evidence/'case.json').exists())
            for error in (RuntimeError('actual case failure'),ValueError('budget-not-executed/no-result: untyped text')):
                actual={'outcome':'case-started'};profile.record_failure(actual,error)
                self.assertEqual(actual['outcome'],'case-failed-or-incomplete')

    def test_dependency_inventory_links_are_metadata_only(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);deps=root/'node_modules';deps.mkdir();(deps/'.bin').mkdir();(deps/'pkg').mkdir()
            script=deps/'pkg/cli.js';script.write_bytes(b'fixture')
            outside=root/'outside';outside.mkdir();sentinel=outside/'sentinel';sentinel.write_bytes(b'outside'*200000)
            os.mkfifo(outside/'must-not-traverse')
            links=[deps/'.bin/tool',deps/'outside-file',deps/'outside-directory']
            links[0].symlink_to('../pkg/cli.js');links[1].symlink_to(sentinel);links[2].symlink_to(outside,target_is_directory=True)
            before=(hashlib.sha256(sentinel.read_bytes()).hexdigest(),sentinel.stat().st_mtime_ns)
            expected=script.stat().st_size+sum(link.lstat().st_size for link in links)
            original=profile.os.scandir
            with patch.object(profile,'DEPENDENCY_ROOTS',(deps,)),patch.object(profile.os,'readlink',side_effect=AssertionError('must not read targets')),patch.object(profile.os,'scandir',wraps=original)as scanned:
                value=profile.dependency_inventory(deps)
                self.assertEqual(scanned.call_count,3) # root, .bin, pkg; never outside linked directory.
                self.assertEqual(value,{'logical_bytes':expected,'regular_files':1,'directories':2,'link_entries':3,'link_bytes':expected-7,'entries':6})
                with self.assertRaises(ValueError):profile.dependency_inventory(outside)
                with self.assertRaises(ValueError):profile.size(deps)
                with self.assertRaises(OSError):profile.regular(links[0])
            self.assertEqual((hashlib.sha256(sentinel.read_bytes()).hexdigest(),sentinel.stat().st_mtime_ns),before)
            self.assertTrue((outside/'must-not-traverse').exists())
            root_link=root/'linked-root';root_link.symlink_to(deps,target_is_directory=True)
            with patch.object(profile,'DEPENDENCY_ROOTS',(root_link,)),self.assertRaises(OSError):profile.dependency_inventory(root_link)

    def test_cached_dependency_tree_characterization(self):
        rows=[]
        for path in profile.DEPENDENCY_ROOTS:
            value=profile.dependency_inventory(path)
            self.assertGreater(value['regular_files'],0);self.assertGreater(value['link_entries'],0)
            rows.append({'root':str(path),**value})
        self.assertLessEqual(sum(row['logical_bytes']for row in rows),2*profile.GIB)
        print(json.dumps({'operation':'read-only lstat accounting; no target reads/traversal; no native/build execution','dependencies':rows},sort_keys=True))
        text=(ROOT/'.github/scripts/terminal-observer-profile.py').read_text()
        self.assertIn("sum(dependency_inventory(p)['logical_bytes']for p in DEPENDENCY_ROOTS)",text)
        self.assertIn("sample['dependency_bytes']<=2*GIB",text)
        self.assertIn("shutil.disk_usage(self.home).free>=13*GIB",text)

    def test_compiler_hardlink_characterizes_strict_red_and_identity_green(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);binary=root/'target/debug/nac-web';binary.parent.mkdir(parents=True)
            binary.write_bytes(b'#!/bin/sh\nexit 0\n');binary.chmod(0o700)
            alias=root/'compiler-alias';os.link(binary,alias);evidence=root/'evidence';evidence.mkdir()
            with self.assertRaisesRegex(ValueError,'single-link'):profile.digest(binary)
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'scandir',side_effect=AssertionError('no traversal')),patch.object(profile.os,'walk',side_effect=AssertionError('no traversal')),patch.object(profile.subprocess,'Popen')as spawn:
                value=profile.compiler_identity(evidence);spawn.assert_not_called()
            self.assertEqual(value,{'sha256':hashlib.sha256(alias.read_bytes()).hexdigest(),'bytes':17})
            receipt=json.loads((evidence/'compiler-output-identity.json').read_text())
            self.assertTrue(receipt['accepted']);self.assertEqual(receipt['descriptor_before']['nlink'],2)
            self.assertEqual(receipt['descriptor_before'],receipt['descriptor_after'])
            print(json.dumps({'owned_fixture_only':True,'strict_reader':'rejected nlink2','compiler_identity':receipt},sort_keys=True))

    def test_compiler_rejects_links_nonregular_and_outside_without_execution(self):
        for kind in ('symlink','fifo','directory','parent-link','nonexecutable','oversized'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);binary=root/'target/debug/nac-web';binary.parent.mkdir(parents=True)
                outside=root/'outside';outside.mkdir();sentinel=outside/'sentinel';sentinel.write_bytes(b'unchanged');sentinel.chmod(0o700)
                before=(sentinel.read_bytes(),sentinel.stat().st_mtime_ns)
                if kind=='symlink':binary.symlink_to(sentinel)
                elif kind=='fifo':os.mkfifo(binary)
                elif kind=='directory':binary.mkdir()
                elif kind=='parent-link':
                    binary.parent.rmdir();binary.parent.symlink_to(outside,target_is_directory=True)
                else:
                    binary.write_bytes(b'fixture');binary.chmod(0o600 if kind=='nonexecutable'else 0o700)
                    if kind=='oversized':
                        with binary.open('r+b')as handle:handle.truncate(512*1024**2+1)
                evidence=root/'evidence';evidence.mkdir()
                with patch.object(profile,'ROOT',root),patch.object(profile.os,'read',side_effect=AssertionError('invalid output must not be read')),patch.object(profile.os,'scandir',side_effect=AssertionError('no traversal')),patch.object(profile.subprocess,'Popen')as spawn:
                    with self.assertRaises((OSError,ValueError)):profile.compiler_identity(evidence)
                    spawn.assert_not_called()
                receipt=json.loads((evidence/'compiler-output-identity.json').read_text());self.assertFalse(receipt['accepted']);self.assertIn('error',receipt)
                self.assertEqual((sentinel.read_bytes(),sentinel.stat().st_mtime_ns),before)
                if kind!='parent-link':self.assertIsNotNone(receipt['leaf_lstat'])
                with self.assertRaises(TypeError):profile.compiler_identity(evidence,sentinel)

    def test_compiler_rejects_real_metadata_change_and_keeps_case_after_identity(self):
        with tempfile.TemporaryDirectory()as directory:
            root=Path(directory);binary=root/'target/debug/nac-web';binary.parent.mkdir(parents=True)
            binary.write_bytes(b'original');binary.chmod(0o700);evidence=root/'evidence';evidence.mkdir()
            original_read=profile.os.read;changed=False;before=binary.stat()
            def mutate(fd,count):
                nonlocal changed
                value=original_read(fd,count)
                if not changed:
                    changed=True;binary.write_bytes(b'changed!');os.utime(binary,ns=(before.st_atime_ns,before.st_mtime_ns+1000000))
                return value
            with patch.object(profile,'ROOT',root),patch.object(profile.os,'read',side_effect=mutate),patch.object(profile.subprocess,'Popen')as spawn:
                with self.assertRaisesRegex(ValueError,'metadata changed'):profile.compiler_identity(evidence)
                spawn.assert_not_called()
            receipt=json.loads((evidence/'compiler-output-identity.json').read_text());self.assertFalse(receipt['accepted'])
            self.assertNotEqual(receipt['descriptor_before'],receipt['descriptor_after'])
            self.assertEqual(receipt['descriptor_before']['size'],receipt['descriptor_after']['size'])
        source=(ROOT/'.github/scripts/terminal-observer-profile.py').read_text()
        positions=[source.index(value)for value in ("result['binary']=compiler_identity(controller.evidence)","controller.run('version'","controller.run('guide'","verify_identities(expected,version,guide,controller.evidence)","controller.run('case'")]
        self.assertEqual(positions,sorted(positions))

    def test_actual_root_version_preflight_and_original_cargo_lookup_red(self):
        with self.assertRaisesRegex(KeyError,'package'):
            tomllib.loads((ROOT/'Cargo.toml').read_text())['workspace']['package']['version']
        source='eb8091916b5739fcf7f17dc02de1aa9fe9f7ff59'
        value=profile.expected_identity(source)
        self.assertEqual(value,{'product_version':(ROOT/'version.txt').read_text().strip(),'source_revision':source,'track':'dev','build_id':'dev-'+source})
        print(json.dumps({'actual_repository_cargo_lookup':'KeyError package RED','canonical_expected_identity':value,'no_native_execution':True},sort_keys=True))
        text=(ROOT/'.github/scripts/terminal-observer-profile.py').read_text()
        self.assertNotIn('tomllib',text);self.assertNotIn("ROOT/'Cargo.toml'",text)
        main=text[text.index('def main():'):]
        self.assertLess(main.index('expected=expected_identity(args.source)'),main.index("subprocess.check_output(['cargo','--version']"))
        self.assertLess(main.index('expected=expected_identity(args.source)'),main.index('controller.native(apt'))

    def test_version_preflight_missing_malformed_forbidden_and_no_fallback(self):
        for kind in ('missing','symlink','hardlink','fifo','0.1','01.2.3','0.1.4-dev','0.1.4\n0.1.5','','oversize'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);file=root/'version.txt';sentinel=root/'outside';sentinel.write_text('9.8.7\n')
                (root/'Cargo.toml').write_text('[workspace.package]\nversion="9.8.7"\n')
                if kind=='symlink':file.symlink_to(sentinel)
                elif kind=='hardlink':os.link(sentinel,file)
                elif kind=='fifo':os.mkfifo(file)
                elif kind!='missing':file.write_text('1'*129 if kind=='oversize'else kind)
                with patch.object(profile,'ROOT',root),patch.object(profile.subprocess,'Popen')as spawn:
                    with self.assertRaises((ValueError,OSError)):profile.expected_identity('a'*40)
                    spawn.assert_not_called()
                self.assertEqual(sentinel.read_text(),'9.8.7\n')
        for source in ('unknown','A'*40,'a'*39,'a'*41,None):
            with self.subTest(source=source),self.assertRaises(ValueError):profile.expected_identity(source)

    def test_version_and_full_guide_gate_blocks_case_on_every_mismatch(self):
        expected=profile.expected_identity('a'*40)
        identity={'provenance':'first-party bundled NAC Guide','build_identity':expected,'result':{'payload':'must-not-export'}}
        mutations=[None,'version','prefix',*expected.keys(),'provenance','extra','malformed','duplicate']
        for mutation in mutations:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory()as directory:
                root=Path(directory);version=root/'version';guide=root/'guide';evidence=root/'evidence';evidence.mkdir()
                rendered=f"nac-web {expected['product_version']} ({expected['source_revision'][:12]})\n"
                value=json.loads(json.dumps(identity))
                if mutation=='version':rendered='nac-web 9.9.9 ('+'a'*12+')\n'
                elif mutation=='prefix':rendered=rendered.replace('a'*12,'b'*12)
                elif mutation=='source_revision':value['build_identity'][mutation]='a'*12+'b'*28
                elif mutation=='product_version':value['build_identity'][mutation]='9.9.9'
                elif mutation=='track':value['build_identity'][mutation]='stable'
                elif mutation=='build_id':value['build_identity'][mutation]='dev-'+'b'*40
                elif mutation=='provenance':value['provenance']='foreign'
                elif mutation=='extra':value['build_identity']['payload']='secret'
                version.write_text(rendered);guide.write_text('{'if mutation=='malformed'else '{"build_identity":{},"build_identity":{}}'if mutation=='duplicate'else json.dumps(value))
                with patch.object(profile.subprocess,'Popen')as spawn:
                    case=unittest.mock.Mock()
                    if mutation is None:
                        self.assertEqual(profile.verify_identities(expected,version,guide,evidence),expected);case();case.assert_called_once()
                    else:
                        with self.assertRaises(ValueError):
                            profile.verify_identities(expected,version,guide,evidence);case()
                        case.assert_not_called()
                    spawn.assert_not_called()
                receipt=(evidence/'build-identity-comparison.json').read_text();observed=json.loads(receipt)
                self.assertEqual(observed['accepted'],mutation is None)
                self.assertNotIn('secret',receipt);self.assertNotIn('must-not-export',receipt)

    def test_finite_no_retry_private_workflow(self):
        text=(ROOT/'.github/workflows/nightly-portability.yml').read_text()
        self.assertIn('workflow_dispatch:',text);self.assertNotIn('pull_request:',text);self.assertNotIn('schedule:',text)
        self.assertEqual(text.count('runs-on:'),1);self.assertIn('timeout-minutes: 40',text)
        self.assertIn("save-if: 'false'",text);self.assertIn('persist-credentials: false',text)
        self.assertNotIn('secrets:',text);self.assertNotIn('write',text);self.assertIn('shell: bash',text)
        self.assertIn('set -euo pipefail',text);self.assertIn(profile.BRANCH,text)
        controller=(ROOT/'.github/scripts/terminal-observer-profile.py').read_text()
        for value in ('--workers=1','--retries=0',"],720,env)","],180,runtime,WEB)",'13*GIB','12*GIB','512*1024**2'):
            self.assertIn(value,controller)
        self.assertNotIn('retry(',controller)


if __name__=='__main__':unittest.main()
