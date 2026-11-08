import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {aptProducerSteps} from './browser-apt-wiring.mjs';
import {reverseParallelApt} from './browser-apt-parallel-wiring.mjs';
import {reverseAdmission} from './ci-admission-wiring.mjs';
import {reverseElapsedEvidence} from './elapsed-evidence-wiring.mjs';
import {requiredJobs,qualityJobs,managedCallerJobs,requireComplete} from './pr-checks.mjs';

const YAML=createRequire(import.meta.url)('yaml');
const actual=YAML.parse(fs.readFileSync('.github/workflows/stable-release.yml','utf8'));
const source='a'.repeat(40);
function context() {
  const needs=Object.fromEntries(Object.keys(actual.jobs).map(name=>[name,{result:'success',outputs:{}}]));
  needs.prepare.outputs={sha:source,run:'true',admission_mode:'full',cold_caches:'false'};
  return {needs,steps:{'apt-preflight':{outputs:{enabled:'true'}},'apt-plan':{outputs:{mode:'ready'}}}};
}
function evaluate(code,state) {
  code=code.replace(/^\$\{\{\s*|\s*\}\}$/g,'').replace(/(needs|steps)\.([\w-]+)/g,(_,owner,name)=>`${owner}[${JSON.stringify(name)}]`);
  return runInNewContext(code,{...state,always:()=>true,cancelled:()=>false},{timeout:50,contextCodeGeneration:{strings:false,wasm:false}});
}
function project(value,required=requiredJobs) {
  assert.equal(required.filter(name=>name==='browser-apt').length,1);
  const old=structuredClone(value);reverseAssetTokens(old);
  reverseAdmission(old);reverseParallelApt(old,aptProducerSteps);reverseElapsedEvidence(old);
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;
  // Full pre-admission APT graph plus the required startup-custody and native-auth fixture controls.
  assert.equal(createHash('sha256').update(JSON.stringify(sort(old))).digest('hex'),
    '9faf04f1f32d65e2249fbf855c8158e2b24faa652b34d9b370cd6f73542ac167');
}

test('strict split-only projection recovers the complete pre-admission APT graph',()=>project(actual));
test('native work is the exact seven existing steps and has no Rust/cache writer',()=>{
  const job=actual.jobs['browser-apt'];
  assert.equal(job.needs,'prepare');assert.equal(actual.jobs['browser-binary'].needs,'prepare');
  assert.deepEqual(job.steps.slice(1),aptProducerSteps);
  assert.equal(job.steps[0].with.ref,'${{ needs.prepare.outputs.sha }}');
  assert.deepEqual(job.env,{NAC_SOURCE_REVISION:'${{ needs.prepare.outputs.sha }}'});
  assert.ok(!job.steps.some(step=>/rust|cache@/.test(step.uses??'')||/cargo /.test(step.run??'')));
  assert.deepEqual(Object.keys(actual.jobs['browser-binary'].outputs),['receipt','artifact_id']);
  assert.deepEqual(qualityJobs,['prepare','lint','workflow-lint','test-server','test-server-web','test-core','test-workspace']);
});

test('each producer is independent; every consumer requires both actual successful producers',()=>{
  const values=['success','failure','cancelled','skipped','in_progress',undefined];
  for(const binary of values)for(const apt of values) {
    const state=context();state.needs['browser-binary'].result=binary;state.needs['browser-apt'].result=apt;
    assert.equal(evaluate(actual.jobs['browser-binary'].if,state),true);
    assert.equal(evaluate(actual.jobs['browser-apt'].if,state),true);
    for(const role of ['browser-shards','browser-proof'])
      assert.equal(evaluate(actual.jobs[role].if,state),binary==='success'&&apt==='success',role+'/'+binary+'/'+apt);
  }
  const pure=context();pure.needs.prepare.outputs.admission_mode='pure';
  for(const role of ['browser-binary','browser-apt','browser-shards','browser-proof'])
    assert.equal(evaluate(actual.jobs[role].if,pure),false,role);
});

test('cold keeps both required producers but starts no native prefetch or package download',()=>{
  const state=context();state.needs.prepare.outputs.cold_caches='true';
  state.steps['apt-preflight'].outputs.enabled='false';state.steps['apt-plan'].outputs.mode='';
  const native=actual.jobs['browser-apt'];
  assert.equal(evaluate(native.if,state),true);
  assert.equal(evaluate(actual.jobs['browser-binary'].if,state),true);
  assert.equal(evaluate(native.steps[1].env.COLD_APT,state),'true');
  for(const step of native.steps.slice(2,-1))assert.equal(evaluate(step.if,state),false,step.name??step.uses);
  for(const role of ['browser-shards','browser-proof']) {
    state.needs['browser-apt'].outputs.apt_mode='ready';
    const fetch=actual.jobs[role].steps.find(step=>step.name==='Download only the advertised current-run package snapshot');
    assert.equal(evaluate(fetch.if,state),false);
    const normal=actual.jobs[role].steps.find(step=>step.name==='Install Playwright Chromium');
    assert.equal(normal.if,undefined);assert.equal(normal.run,'npx playwright install --with-deps chromium');
  }
});

test('actual browser join shell and final API contract fail on either producer failure',()=>{
  const step=actual.jobs.browser.steps[0];
  for(const role of ['browser-binary','browser-apt'])for(const status of ['success','failure','cancelled','skipped',undefined]) {
    const state=context();state.needs[role].result=status;
    const env={PATH:process.env.PATH,...Object.fromEntries(Object.entries(step.env).map(([key,value])=>[key,String(evaluate(value,state)??'')]))};
    const result=spawnSync('bash',['-e','-c',step.run],{env,encoding:'utf8'});
    assert.equal(result.status===0,status==='success',role+'/'+status);
    const needs=Object.fromEntries([...requiredJobs,...managedCallerJobs].map(name=>[name,{result:'success'}]));
    needs.prepare.outputs={sha:source,run:'true'};needs[role].result=status;
    if(status==='success')requireComplete(needs,'true',source);
    else assert.throws(()=>requireComplete(needs,'true',source));
  }
});

const nativeStep=(w,id)=>w.jobs['browser-apt'].steps.find(step=>step.id===id);
for(const[name,mutate]of Object.entries({
  'serialized native producer':w=>w.jobs['browser-apt'].needs=['prepare','browser-binary'],
  'serialized binary producer':w=>w.jobs['browser-binary'].needs=['prepare','browser-apt'],
  'optional native producer':w=>w.jobs['browser-apt']['continue-on-error']=true,
  'missing required native job':w=>delete w.jobs['browser-apt'],
  'compiler/cache writer in native job':w=>w.jobs['browser-apt'].steps.push({uses:'actions/cache@'+'a'.repeat(40)}),
  'native failure fallback':w=>nativeStep(w,'apt-export').run+=' || true',
  'native source alias':w=>w.jobs['browser-apt'].env.NAC_SOURCE_REVISION='dev',
  'consumer omits producer dependency':w=>w.jobs['browser-proof'].needs.pop(),
  'join omits producer':w=>delete w.jobs.browser.steps[0].env.APT_RESULT,
  'final API omits producer':w=>w.jobs['required-pr-checks'].needs=w.jobs['required-pr-checks'].needs.filter(name=>name!=='browser-apt'),
  'native artifact points at binary':w=>{const s=w.jobs['browser-proof'].steps.find(step=>step.name==='Download only the advertised current-run package snapshot');s.with['artifact-ids']='${{ needs.browser-binary.outputs.artifact_id }}';},
  'cold producer skipped':w=>w.jobs['browser-apt'].if+=' && false',
  'proof selection changed':w=>w.jobs['browser-proof'].steps.find(step=>step.name==='Run production-embedded goal proof journeys').run+=' --retries=1',
}))test(`rejects ${name}`,()=>{
  const changed=structuredClone(actual);mutate(changed);assert.throws(()=>project(changed));
});
test('required API list cannot silently omit native producer',()=>assert.throws(()=>project(actual,requiredJobs.filter(name=>name!=='browser-apt'))));
