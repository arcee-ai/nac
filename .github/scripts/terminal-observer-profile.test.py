#!/usr/bin/env python3
"""Offline preservation and numeric-budget controls; never runs Rust or the case."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import sys
sys.dont_write_bytecode=True
import unittest

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
        self.assertEqual(PINS['base'],'5603ad0bda5d8e62cf9587659f4548131c1bbf45')
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
