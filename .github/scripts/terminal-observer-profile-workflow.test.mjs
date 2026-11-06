import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
const require=createRequire(import.meta.url);
const YAML=require('yaml');
const path=new URL('../workflows/nightly-portability.yml',import.meta.url);
const source=()=>YAML.parse(fs.readFileSync(path,'utf8'));
const pins=[
'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
'dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0',
'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
'Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4',
'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'];
function validate(w){
 assert.deepEqual(Object.keys(w.on),['workflow_dispatch']);
 assert.deepEqual(w.on.workflow_dispatch.inputs,{source:{description:'Exact private committed source SHA (no reruns)',type:'string',required:true}});
 assert.deepEqual(w.permissions,{contents:'read'});
 assert.deepEqual(Object.keys(w.jobs),['profile']);
 const j=w.jobs.profile;
 assert.match(j.name,/^DIAG /); assert.equal(j['runs-on'],'ubuntu-latest'); assert.equal(j['timeout-minutes'],40);
 assert.equal(j.if,"${{ github.ref == 'refs/heads/codex/all-582-terminal-profile-current-20261106' && github.run_attempt == 1 }}");
 assert.deepEqual(j.env,{PYTHONDONTWRITEBYTECODE:'1',CARGO_BUILD_JOBS:'2',CARGO_PROFILE_DEV_DEBUG:'0',CARGO_PROFILE_TEST_DEBUG:'0',CARGO_INCREMENTAL:'0'});
 assert.equal(j.defaults.run.shell,'bash');assert.equal(j.steps.length,8);
 assert.deepEqual(j.steps.filter(s=>s.uses).map(s=>s.uses),pins);
 assert.match(j.steps[0].run,/PROFILE_JOB_ANCHOR=\$\(date \+%s\)/);
 assert.deepEqual(j.steps[1].with,{ref:'${{ github.sha }}','persist-credentials':false});
 assert.deepEqual(j.steps[3].with,{toolchain:'1.98.0'});
 assert.deepEqual(j.steps[4].with,{'node-version':'24.22.1'});
 assert.deepEqual(j.steps[5].with,{'prefix-key':'nac-ci-v1','shared-key':'server-browser-linux-gnu-debug0-v1','save-if':'false'});
 assert.equal(j.steps[7].if,'always()');
 // Anchor, guard and controller are the only executable shell steps.
 assert.equal(j.steps.filter(s=>s.run).length,3);
 for(const s of j.steps.filter(s=>s.run))assert.match(s.run,/^set -euo pipefail\n/);
 assert.match(j.steps[2].run,/test "\$EXPECTED_SOURCE" = "\$GITHUB_SHA"/);
 assert.match(j.steps[6].run,/exec python3 \.github\/scripts\/terminal-observer-profile.py --source "\$EXPECTED_SOURCE"/);
 assert.equal(j.steps[7].with.path,'${{ runner.temp }}/terminal-observer-profile/evidence');
}
test('private one-shot graph/pins/read-only cache and numeric-only upload',()=>validate(source()));
test('negative controls reject privilege, trigger, cache, source, graph or retry expansion',()=>{
 for(const change of [w=>w.on.push={},w=>w.permissions.contents='write',w=>w.jobs.profile.steps[5].with['save-if']='true',w=>w.jobs.profile.steps[1].with.ref='dev',w=>w.jobs.profile.if='true',w=>w.jobs.profile.steps.push({run:'echo extra'}),w=>w.jobs.profile.steps[6].run='python3 script.py | cat',w=>w.jobs.profile.steps[7].with.path='${{ runner.temp }}']){
  const w=source();change(w);assert.throws(()=>validate(w));
 }
});
