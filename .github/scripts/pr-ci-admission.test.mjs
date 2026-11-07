import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import {reverseNativeQualification} from './native-qualification-wiring.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import YAML from 'yaml';
import {reverseAdmission,purePredicate,sourceJobs,sourceGroup,forwardedMode} from './ci-admission-wiring.mjs';
import {aptProducerSteps} from './browser-apt-wiring.mjs';
import {reverseParallelApt} from './browser-apt-parallel-wiring.mjs';
import {reverseElapsedEvidence} from './elapsed-evidence-wiring.mjs';
const stable=YAML.parse(fs.readFileSync('.github/workflows/stable-release.yml','utf8'));
reverseNativeQualification(stable);
// Full pre-admission graph plus this layer's required startup-custody control.
const parentHash="e2f13f6f6f2c2413a5892dc9b6afe135feb83c83d9f37ff2d1357acb6c3c0c0b";
const sealedPins={
  ".github/scripts/ci-admission.py": "afa1c74728cdf5646de034a553c32bc5af6552ecc6fdf0bacab67eca31aef04a",
  ".github/scripts/ci-admission-bootstrap.py": "df4d0eac66df699dfae980bdca700f160a383d2a5d1a501b6232f1c049cf0ff0",
  ".github/scripts/ci-admission-contract.json": "d3f4dfffe12024b54ad5ade8023ee9ec3b4cf9867dec01c442b58b19a1593cb9",
  ".github/scripts/ci-admission-applicability.json": "7dea3225509631c4dc6dc2947ab9fcf75b8dbd62ff0172bd394815c3a99f56e7",
  ".github/scripts/cold-caches.py": "2b2ea35fd7fa77f036ab6d7e9e1d7fbf974f5c33a070c13b55356664d626f07b",
  ".github/scripts/pr-checks.mjs": "1c12e1ed2fa2aa78707ae46da445edf2f774eab689721771ff52069122667127",
  ".github/scripts/publication-policy.mjs": "c62bba4c71700fc57c48605b5b7209415513b8a7b2bce33b391595e8952a8018",
  ".github/workflows/ci-admission.yml": "d6979c9db4619f87a1321ff3f1e18d30a0004eb6e03035752b08997c16c25c27"
};
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;
const digest=value=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
function expression(source,context={}){
 const code=source.replace(/^\$\{\{\s*|\s*\}\}$/g,'').replace(/needs\.([\w-]+)/g,(_,name)=>`needs[${JSON.stringify(name)}]`);
 return runInNewContext(code,{always:()=>true,cancelled:()=>false,startsWith:(a,b)=>a.startsWith(b),
  format:(s,...args)=>s.replace(/\{(\d+)\}/g,(_,i)=>args[i]),...context},{timeout:50,contextCodeGeneration:{strings:false,wasm:false}});
}
function github(action='edited',changed=false,run=30,event='pull_request'){
 return {workflow:'Stable release',event_name:event,run_id:run,run_attempt:1,ref:'refs/heads/dev',
  event:{action,changes:changed?{base:{from:{ref:'old'}}}:{},pull_request:{number:621}}};
}
function state(mode='full'){
 const needs=Object.fromEntries(['prepare','ci-admission',...Object.keys(sourceJobs)].map(id=>[id,{result:'success',outputs:{}}]));
 needs.prepare.outputs={admission_mode:mode,run:'true',managed_applicable:'true'};
 needs['ci-admission'].outputs.mode=mode;
 return {github:github(),needs};
}
function group(source,g){return source.replace(/\$\{\{([\s\S]*?)\}\}/g,(_,body)=>expression(body,{github:g}));}

test('FULL split projection preserves the landed graph; six authority pins unchanged and two explicitly rebound',()=>{
 const normalized=structuredClone(stable);reverseAssetTokens(normalized);reverseAdmission(normalized);reverseParallelApt(normalized,aptProducerSteps);reverseElapsedEvidence(normalized);assert.equal(digest(normalized),parentHash);
 for(const [path,expected]of Object.entries(sealedPins))assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),expected,path);
});
test('actual pre-prepare routing isolates edits and ready before pending-source replacement',()=>{
 const source=group(stable.concurrency.group,github('synchronize',false,1));
 const running=new Map([[source,{running:'source-R',pending:'source-P'}]]);
 function enqueue(g,id){const key=group(stable.concurrency.group,g);const slot=running.get(key)??{};slot.pending=id;running.set(key,slot);return key;}
 for(const [action,run]of [['edited',2],['ready_for_review',3],['edited',4]]){
  const key=enqueue(github(action,false,run),'metadata-'+run);assert.notEqual(key,source);
  assert.equal(running.get(source).pending,'source-P');
 }
 assert.equal(enqueue(github('edited',true,5),'base-change'),source);
 assert.equal(running.get(source).pending,'base-change');
 // Documented queue semantics negative: false running-cancellation cannot save pending.
 const old=group(sourceGroup,github('edited',false,6));assert.equal(old,source);
 for(const event of ['push','workflow_dispatch'])assert.notEqual(group(stable.concurrency.group,github('',false,7,event)),source);
 assert.equal(stable.concurrency['cancel-in-progress'],"${{ github.event_name == 'pull_request' && (github.event.action == 'synchronize' || github.event.changes.base != null) }}");
});
test('actual forwarding only accepts typed successful edited/basefalse PURE; all source/failure cases FULL',()=>{
 for(const action of ['opened','synchronize','reopened','ready_for_review','edited'])
  for(const changed of [false,true])
   for(const result of ['success','failure','cancelled','skipped',undefined])
    for(const mode of ['pure','full','true',true,'',undefined]){
     const ctx=state();ctx.github=github(action,changed);ctx.needs['ci-admission']={result,outputs:{mode}};
     const actual=expression(stable.jobs.prepare.outputs.admission_mode,ctx);
     assert.equal(actual,action==='edited'&&!changed&&result==='success'&&mode==='pure'?'pure':'full');
    }
 for(const event of ['push','workflow_dispatch']){const ctx=state('pure');ctx.github=github('edited',false,30,event);assert.equal(expression(forwardedMode,ctx),'full');}
 assert.equal(stable.jobs.prepare.needs,'ci-admission');assert.equal(stable.jobs.prepare.if,'${{ always() }}');
});
test('real FULL conditions retain original direct-dependency failure semantics, even after unit failure',()=>{
 for(const [id,config]of Object.entries(sourceJobs)){
  if(id==='required-pr-checks')continue;
  const deps=Array.isArray(config.needs)?config.needs:[config.needs];
  for(const failed of [null,...deps])for(const status of ['success','failure','cancelled','skipped']){
   const ctx=state();ctx.needs['ci-admission'].result='failure';if(failed)ctx.needs[failed].result=status;
   const old=config.if??'true';const hasAlways=old.includes('always()');
   const expected=Boolean(expression(old,ctx))&&(hasAlways||deps.every(dep=>ctx.needs[dep].result==='success'));
   assert.equal(expression(stable.jobs[id].if,ctx),expected,id+'/'+failed+'/'+status);
  }
 }
});
test('PURE emits no protected source context; failed prepare cannot claim PURE names or bypass aggregate',()=>{
 const ctx=state('pure');
 for(const [id,job]of Object.entries(stable.jobs)){
  if(['prepare','ci-admission','required-pr-checks'].includes(id))continue;
  assert.equal(expression(job.if,ctx),false,id);
 }
 const protectedIds=['required-pr-checks','source-security','macos-native'];
 const originalNames=['Required PR checks','source-security','macos-native'];
 for(const [i,id]of protectedIds.entries())assert.notEqual(expression(stable.jobs[id].name,ctx),originalNames[i]);
 for(const step of stable.jobs['required-pr-checks'].steps)assert.equal(expression(step.if,ctx),false);
 ctx.needs.prepare.result='failure';
 for(const [i,id]of protectedIds.entries())assert.equal(expression(stable.jobs[id].name,ctx),originalNames[i]);
 for(const step of stable.jobs['required-pr-checks'].steps)assert.equal(expression(step.if,ctx),true);
 assert.equal(expression(stable.jobs['required-pr-checks'].if,ctx),true);
});
test('normalization rejects changed trust, defaults, coverage, APT or extra work instead of deleting it',()=>{
 for(const mutate of [w=>w.concurrency.group=sourceGroup,w=>w.jobs.prepare.outputs.admission_mode="${{ 'pure' }}",
  w=>w.jobs['source-security'].name='source-security',w=>w.jobs['ci-admission'].if='false',
  w=>w.jobs.lint.if='false',w=>w.jobs['required-pr-checks'].steps.at(-1).if='false',
  w=>w.jobs['browser-apt'].steps.find(s=>s.id==='apt-upload').with['retention-days']=1,
  w=>w.permissions.actions='write',w=>w.jobs.extra={steps:[]},
  w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Upload selected elapsed interval evidence').with.path+='extra.json\n',
  w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Upload selected elapsed interval evidence').if='success()',
  w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Upload selected elapsed interval evidence').with['retention-days']=4,
  w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Upload selected elapsed interval evidence')['continue-on-error']=true,
  w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Upload browser shard failure artifacts').with.path='crates/nac-server/web/test-results']){
  const value=structuredClone(stable);mutate(value);
  assert.throws(()=>{reverseAssetTokens(value);reverseAdmission(value);reverseParallelApt(value,aptProducerSteps);reverseElapsedEvidence(value);assert.equal(digest(value),parentHash);});
 }
});
