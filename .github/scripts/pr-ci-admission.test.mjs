import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import YAML from 'yaml';
import {reverseAdmission,purePredicate,sourceJobs,sourceGroup,forwardedMode} from './ci-admission-wiring.mjs';
const stable=YAML.parse(fs.readFileSync('.github/workflows/stable-release.yml','utf8'));
const landed=YAML.parse(execFileSync('git',['show','f440666602b15e7a00994e180576cd1338ad4e36:.github/workflows/stable-release.yml'],{encoding:'utf8'}));
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

test('FULL projection equals entire landed APT graph; all eight sealed authority pins unchanged',()=>{
 const normalized=structuredClone(stable);reverseAdmission(normalized);assert.deepEqual(normalized,landed);
 for(const file of ['ci-admission.py','ci-admission-bootstrap.py','ci-admission-contract.json','ci-admission-applicability.json','cold-caches.py','pr-checks.mjs','publication-policy.mjs']){
  const path='.github/scripts/'+file;
  assert.deepEqual(fs.readFileSync(path),execFileSync('git',['show','e6acb6b24bbf022e8a2f19fd2a81068c5e5bc42f:'+path]));
 }
 assert.deepEqual(fs.readFileSync('.github/workflows/ci-admission.yml'),execFileSync('git',['show','e6acb6b24:.github/workflows/ci-admission.yml']));
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
 assert.equal(stable.concurrency['cancel-in-progress'],landed.concurrency['cancel-in-progress']);
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
  w=>w.jobs['browser-binary'].steps.find(s=>s.id==='apt-upload').with['retention-days']=1,
  w=>w.permissions.actions='write',w=>w.jobs.extra={steps:[]}]){
  const value=structuredClone(stable);mutate(value);
  assert.throws(()=>{reverseAdmission(value);assert.deepEqual(value,landed);});
 }
});
