import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const YAML=require('yaml');
const read=file=>fs.readFileSync(file,'utf8');
const stable=YAML.parse(read('.github/workflows/stable-release.yml'));
const evidence=YAML.parse(read('.github/workflows/heartbeat-evidence.yml'));

test('ordinary workflow checks include only pure evidence controls',()=>{
 const make=read('Makefile');
 assert.match(make,/^test-workflow-lint: test-heartbeat-evidence-controls$/m);
 const target=make.match(/^test-heartbeat-evidence-controls:\n((?:\t[^\n]*\n)+)/m)?.[1];
 assert.ok(target);
 assert.deepEqual(target.trim().split('\n').map(s=>s.trim()),[
  'python3 -B .github/scripts/heartbeat-evidence/contract.test.py',
  'python3 -B .github/scripts/heartbeat-evidence/custody.test.py',
  'python3 -B .github/scripts/heartbeat-evidence/custody_check.test.py',
  'node --test .github/scripts/heartbeat-evidence.test.mjs',
  'node --check .github/scripts/heartbeat-evidence/capture.mjs',
 ]);
 assert.ok(Object.values(stable.jobs).some(job=>job.steps?.some(step=>
  step.run?.includes('make lint-workflows test-workflow-lint'))));
});

function route(expression,event,mode){
 let body=expression.replace(/^\$\{\{\s*|\s*\}\}$/g,'');
 body=body.replaceAll('github.event_name',JSON.stringify(event)).replaceAll('inputs.heartbeat_evidence',JSON.stringify(mode)).replaceAll('always()','true');
 assert.match(body,/^[\s\w"'!=&|()\-]*$/);
 return Function(`"use strict"; return (${body});`)();
}

test('ordinary events and default none retain ordinary required CI; evidence is explicit',()=>{
 assert.equal(stable.on.workflow_dispatch.inputs.heartbeat_evidence.default,'none');
 assert.deepEqual(stable.on.workflow_dispatch.inputs.heartbeat_evidence.options,['none','matched-and-measure','custody-check']);
 for(const [event,mode,selected] of [['push','',false],['pull_request','',false],['workflow_dispatch','',false],['workflow_dispatch','none',false],['workflow_dispatch','matched-and-measure',true],['workflow_dispatch','invalid',true]]){
  assert.equal(route(stable.jobs['heartbeat-evidence'].if,event,mode),selected);
  assert.equal(route(stable.jobs.prepare.if,event,mode),!selected);
  assert.equal(route(stable.jobs['required-pr-checks'].if,event,mode),!selected);
 }
 assert.match(stable.jobs.publish.if,/github\.event_name == 'push'/);
 assert.match(stable.jobs.publish.if,/startsWith\(github.ref, 'refs\/tags\/v'\)/);
});

test('reusable evidence is not a new manual registration, PR lane, timer or release publisher',()=>{
 assert.deepEqual(Object.keys(evidence.on),['workflow_call']);
 assert.equal(stable.jobs['heartbeat-evidence'].uses,'./.github/workflows/heartbeat-evidence.yml');
 assert.deepEqual(evidence.permissions,{contents:'read'});
 assert.equal(evidence.concurrency['cancel-in-progress'],false);
 assert.deepEqual(Object.keys(evidence.jobs),['evidence']);
 assert.equal(evidence.jobs.evidence['runs-on'],'ubuntu-latest');
 assert.equal(evidence.jobs.evidence['timeout-minutes'],"${{ inputs.mode == 'custody-check' && 5 || 45 }}");
 assert.equal(evidence.jobs.evidence.strategy,undefined);
 assert.equal(evidence.jobs.evidence.services,undefined);
 assert.equal(stable.jobs['heartbeat-evidence'].secrets,undefined);
});

test('control is event SHA, product is independently pinned, and artifacts survive success',()=>{
 const steps=evidence.jobs.evidence.steps;
 const checkouts=steps.filter(s=>s.uses?.startsWith('actions/checkout@'));
 assert.equal(checkouts[0].with.ref,'${{ github.sha }}');
 assert.equal(checkouts[1].with.ref,'48b9769453c7cb0b245d9f9b1f955ef4a880a431');
 assert.ok(checkouts.every(s=>s.with['persist-credentials']===false));
 const bind=steps.findIndex(s=>s.name?.startsWith('Bind explicit'));
 const setup=steps.findIndex(s=>s.run?.includes('make setup >'));
 const run=steps.findIndex(s=>s.run?.includes('heartbeat-evidence/run.py'));
 assert.ok(bind<setup&&setup<run);
 assert.match(steps[bind].run,/validate_request/);
 assert.match(steps[bind].run,/EXPECTED_CONTROL.*GITHUB_SHA/);
 assert.match(steps[bind].run,/finally:[\s\S]*dispatch.json/);
 assert.match(steps[setup].run,/setup-terminal.json/);
 const upload=steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));
 assert.equal(upload.if,'always()');
 assert.equal(upload.with['if-no-files-found'],'error');
 assert.match(upload.with.name,/github.run_attempt/);
 assert.equal(steps.some(s=>/workflow run|rerun|dispatches|gh api/.test(s.run??'')),false);
});

test('capture retains settled matched-state and no-work assertions, with no screenshot mutation',()=>{
 const source=read('.github/scripts/heartbeat-evidence/capture.mjs');
 for(const assertion of ["inspection.status()!==404","meta.before.active_run!=null","JSON.stringify(meta.before)!==JSON.stringify(meta.after)","meta.after.active_run!=null||providerRequests.length","if(groups.length)cleanup.status='UNRESOLVED'","stable_frames:frames","clipped_text:false","fonts:'loaded'"])
  assert.ok(source.includes(assertion),assertion);
 assert.match(source,/\['GET','HEAD'\]/);
 assert.match(source,/baseline='adefd79e7b43c35f98d760ffa5ff846dc8c13e32'/);
 assert.equal(/page\.route|addStyleTag|mask:|animations:'disabled'/.test(source),false);
 assert.equal(source.includes('process.kill('),false);
 assert.ok(source.includes("child.kill('SIGTERM')"));
});


test('custody-only proves real cancellation before costly setup and cannot run product steps',()=>{
 const steps=evidence.jobs.evidence.steps;
 const gate=steps.findIndex(s=>s.run?.includes('custody_check.py'));
 const setup=steps.findIndex(s=>s.run?.includes('make setup >'));
 assert.ok(gate>0&&gate<setup);
 const product=steps.filter(s=>s.with?.path==='product'||s.uses?.startsWith('dtolnay/rust-toolchain@')||s.uses?.startsWith('actions/setup-node@')||s.working_directory||s['working-directory']||s.run?.includes('heartbeat-evidence/run.py'));
 assert.equal(product.length,6);
 assert.ok(product.every(s=>s.if==="${{ inputs.mode == 'matched-and-measure' }}"));
 assert.match(steps[gate-1].run,/require\(mode in \(MODE, CUSTODY_MODE\)/);
 assert.equal(steps.at(-1).if,'always()');
});

test('workflow import policy reaches named cases from a clean tracked control tree',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nac-import-policy-'));
 const steps=evidence.jobs.evidence.steps;
 const binding=steps.find(s=>s.name?.startsWith('Bind explicit')).run;
 const bindingLines=binding.trim().split('\n');
 const bindingLaunch=bindingLines[0].match(/^python3\s+(-B\s+)?- <<'PY'$/);
 assert.ok(bindingLaunch,'Inspect the actual inline Python launch policy');
 assert.equal(bindingLines.at(-1),'PY');
 const driver=steps.find(s=>s.run?.includes('custody_check.py')).run;
 const driverLaunch=driver.match(/^python3\s+(-B\s+)?(control\/\.github\/scripts\/heartbeat-evidence\/custody_check.py)\s+\\/);
 assert.ok(driverLaunch,'Inspect the actual driver Python launch policy');
 const harness=String.raw`
import importlib.util,json,pathlib,sys
from unittest.mock import patch
entry=pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0,str(entry.parent))
def audit(event,args):
    if event=='subprocess.Popen':
        argv=args[1]
        allowed=[['git','--no-optional-locks','-C',str(entry.parent),*tail]
                 for tail in (['rev-parse','HEAD'],['status','--porcelain'])]
        if argv not in allowed:raise AssertionError('ONLY_CONTROL_GIT_READS_ALLOWED')
    if event.startswith(('socket.','ctypes.')) or event in ('os.kill','os.killpg','os.fork'):
        raise AssertionError('REAL_RUNTIME_FORBIDDEN')
sys.addaudithook(audit)
spec=importlib.util.spec_from_file_location('fixture_entrypoint',entry)
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
calls=[]
def fake_case(case,output):
    calls.append(case)
    return {'state':'PASS_REAL_CUSTODY_ONLY','case':case,'runtime':'MOCKED'}
sys.argv=[str(entry),'--output',sys.argv[2]]
with patch.object(fixture.platform,'system',return_value='Linux'), \
     patch.object(fixture.signal,'signal'),patch.object(fixture,'one_case',side_effect=fake_case), \
     patch.object(fixture,'Kernel',side_effect=AssertionError('REAL_KERNEL_FORBIDDEN')):
    try:fixture.main()
    finally:print(json.dumps({'cases':calls,'dont_write_bytecode':sys.dont_write_bytecode}))
`;
 function probe(name,preflightPolicy,driverPolicy,dirty=false){
  const work=path.join(directory,name),control=path.join(work,'control');
  const scripts=path.join(control,'.github/scripts/heartbeat-evidence');
  const temporary=path.join(work,'runner-temp');
  fs.mkdirSync(scripts,{recursive:true});
  fs.mkdirSync(temporary);
  fs.copyFileSync('.gitignore',path.join(control,'.gitignore'));
  for(const file of ['contract.py','owned_process.py','namespace_custody.py','run.py','custody_check.py'])
   fs.copyFileSync('.github/scripts/heartbeat-evidence/'+file,path.join(scripts,file));
  // Child-local configuration excludes host ignore/cache/signing settings.
  const environment={PATH:process.env.PATH,HOME:work,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  const git=(...args)=>{
   const result=spawnSync('git',['-c','core.excludesFile=/dev/null','-C',control,...args],{env:environment,encoding:'utf8',timeout:10000});
   assert.equal(result.status,0,result.stderr);
   return result.stdout.trim();
  };
  git('init','--quiet');git('add','.');
  git('-c','user.name=Source control fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Tracked source fixture');
  const head=git('rev-parse','HEAD');
  assert.equal(git('status','--porcelain'),'');
  if(dirty)fs.writeFileSync(path.join(control,'substantive-untracked.txt'),'must still fail closed');
  const event=path.join(work,'event.json');
  fs.writeFileSync(event,JSON.stringify({inputs:{heartbeat_evidence:'custody-check',heartbeat_control_sha:head}}));
  const common={...environment,EXPECTED_CONTROL:head,GITHUB_SHA:head,GITHUB_ACTIONS:'true',
   GITHUB_REF:'refs/heads/codex/all-480-linux-evidence',GITHUB_EVENT_NAME:'workflow_dispatch',
   EVIDENCE_MODE:'custody-check',GITHUB_EVENT_PATH:event,RUNNER_TEMP:temporary};
  const policy=value=>value===undefined?{}:{PYTHONDONTWRITEBYTECODE:String(value)};
  const preflight=spawnSync('python3',[...(bindingLaunch[1]?['-B']:[]),'-'],{
   cwd:work,env:{...common,...policy(preflightPolicy)},input:bindingLines.slice(1,-1).join('\n')+'\n',encoding:'utf8',timeout:10000});
  assert.equal(preflight.status,0,preflight.stderr);
  const afterPreflight=git('status','--porcelain');
  const result=spawnSync('python3',[...(driverLaunch[1]?['-B']:[]),'-c',harness,
   path.join(work,driverLaunch[2]),path.join(temporary,'heartbeat-evidence/custody')],{
   cwd:work,env:{...common,...policy(driverPolicy)},encoding:'utf8',timeout:10000});
  return {status:result.status,stdout:result.stdout,stderr:result.stderr,afterPreflight,
   afterDriver:git('status','--porcelain')};
 }
 try{
  const negative=probe('default-imports',undefined,undefined);
  assert.match(negative.afterPreflight,/__pycache__/);
  assert.notEqual(negative.status,0);
  assert.match(negative.stderr,/CONTROL_REVISION/);
  assert.deepEqual(JSON.parse(negative.stdout.trim()).cases,[]);
  const partial=probe('preflight-only',1,undefined);
  assert.equal(partial.afterPreflight,'');
  assert.match(partial.afterDriver,/__pycache__/);
  assert.notEqual(partial.status,0);
  assert.match(partial.stderr,/CONTROL_REVISION/);
  const jobPolicy=evidence.jobs.evidence.env.PYTHONDONTWRITEBYTECODE;
  const actual=probe('actual-workflow',jobPolicy,jobPolicy);
  assert.equal(actual.status,0,JSON.stringify(actual,null,2));
  assert.equal(String(jobPolicy),'1');
  assert.equal(actual.afterPreflight,'');
  assert.equal(actual.afterDriver,'');
  assert.deepEqual(JSON.parse(actual.stdout.trim()),{cases:['controller','wrapper'],dont_write_bytecode:true});
  const substantive=probe('untracked-source',jobPolicy,jobPolicy,true);
  assert.notEqual(substantive.status,0);
  assert.match(substantive.stderr,/CONTROL_REVISION/);
  assert.match(substantive.afterDriver,/substantive-untracked.txt/);
  assert.doesNotMatch(substantive.afterDriver,/__pycache__/);
  assert.deepEqual(JSON.parse(substantive.stdout.trim()).cases,[]);
  const summary=result=>({status:result.status,afterPreflight:result.afterPreflight,
   afterDriver:result.afterDriver,report:JSON.parse(result.stdout.trim()),
   controlRevision:/CONTROL_REVISION/.test(result.stderr)});
  t.diagnostic(JSON.stringify({runtime:'MOCKED',jobPolicy,negative:summary(negative),
   preflightOnly:summary(partial),actual:summary(actual),substantive:summary(substantive)}));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
