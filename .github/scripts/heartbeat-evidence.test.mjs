import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const YAML=require('yaml');
const read=file=>fs.readFileSync(file,'utf8');
const stable=YAML.parse(read('.github/workflows/stable-release.yml'));
const evidence=YAML.parse(read('.github/workflows/heartbeat-evidence.yml'));

function route(expression,event,mode){
 let body=expression.replace(/^\$\{\{\s*|\s*\}\}$/g,'');
 body=body.replaceAll('github.event_name',JSON.stringify(event)).replaceAll('inputs.heartbeat_evidence',JSON.stringify(mode)).replaceAll('always()','true');
 assert.match(body,/^[\s\w"'!=&|()\-]*$/);
 return Function(`"use strict"; return (${body});`)();
}

test('ordinary events and default none retain ordinary required CI; evidence is explicit',()=>{
 assert.equal(stable.on.workflow_dispatch.inputs.heartbeat_evidence.default,'none');
 assert.deepEqual(stable.on.workflow_dispatch.inputs.heartbeat_evidence.options,['none','matched-and-measure']);
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
 assert.equal(evidence.jobs.evidence['timeout-minutes'],45);
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
