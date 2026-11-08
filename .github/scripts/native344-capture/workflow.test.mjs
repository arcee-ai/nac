import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url),YAML=require('yaml');
const root=path.resolve(import.meta.dirname,'../../..');
const text=fs.readFileSync(path.join(root,'.github/workflows/stable-release.yml'),'utf8');
const workflow=YAML.parse(text),job=workflow.jobs.capture,steps=job.steps;
const packet=process.env.NAC_CALLER_TEST_PACKET;
test('only existing registered manual workflow and exact branch/first job',()=>{
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
 assert.deepEqual(Object.keys(workflow.jobs),['capture']);
 assert.equal(workflow.on.workflow_dispatch.inputs.capture_admission.required,true);
 assert.match(job.if,/experimental-native-p12-lifecycle-capture-consumer01/);assert.match(job.if,/github.run_attempt == 1/);
 assert.equal(job['runs-on'],'macos-26');assert.equal(job['timeout-minutes'],60);
 assert.deepEqual(workflow.permissions,{contents:'read',actions:'read'});
 assert.equal(job.env.GITHUB_SHA,undefined);
});
test('checkout actual HEAD plus exact product without credential persistence',()=>{
 const checkouts=steps.filter(s=>s.uses?.startsWith('actions/checkout@'));
 assert.equal(checkouts.length,2);
 assert.equal(checkouts[0].with.ref,'${{ github.sha }}');assert.equal(checkouts[0].with['fetch-depth'],2);
 assert.equal(checkouts[1].with.ref,'4b7a1f3e0bf6175a77c5ebf627fe965860e99976');
 for(const s of checkouts)assert.equal(s.with['persist-credentials'],false);
});
test('same reviewed action revisions, no unregistered extra workflow or hidden job',()=>{
 const actions=steps.filter(s=>s.uses).map(s=>s.uses);
 assert(actions.includes('dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0'));
 assert(actions.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'));
 assert(actions.includes('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'));
 assert(actions.includes('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'));
 assert(actions.every(a=>/@[0-9a-f]{40}$/.test(a)));
});
test('fixed producer transfer follows metadata, setup and closed preparation',()=>{
 const at=needle=>steps.findIndex(s=>s.run?.includes(needle));
 const download=steps.findIndex(s=>s.uses?.startsWith('actions/download-artifact@'));
 assert(at('--setup controller')<at('--metadata'));assert(at('--setup P')<at('--metadata'));
 assert(at('--metadata')<download);assert(download<at('--prepare'));assert(at('--prepare')<at('--episode'));
 const d=steps[download].with;assert.equal(d['artifact-ids'],13607980704);assert.equal(d['run-id'],42455455480);assert.equal(d.repository,'arcee-ai/nac');
 const tokens=steps.filter(s=>s.env?.GH_TOKEN);assert.equal(tokens.length,1);assert.match(tokens[0].run,/--metadata$/);
});
test('one bounded artifact and hard-deadline gates, no package/raw streams',()=>{
 const uploads=steps.filter(s=>s.uses?.startsWith('actions/upload-artifact@'));assert.equal(uploads.length,1);
 assert.equal(uploads[0].with.path,'${{ runner.temp }}/native344-capture-retained');assert.equal(uploads[0].with['retention-days'],3);
 assert.match(steps.find(s=>s.run?.includes('--retain')).if,/always/);
 assert(steps.filter(s=>['retention','upload'].includes(s.id) && s.run?.includes('HARD_DEADLINE')).length===2);
});
test('extract actual inline programs for guarded inert execution',()=>{
 assert(packet,'explicit inert packet path required');
 const programs=steps.filter(s=>s.run?.startsWith("python3 -B - <<'PYCODE'"));assert.equal(programs.length,3);
 for(let i=0;i<programs.length;i++){
  const script=programs[i].run.split('\n').slice(1,-2).join('\n')+'\n';
  fs.writeFileSync(path.join(packet,`inline-${i}.py`),script);
 }
 fs.writeFileSync(path.join(packet,'WORKFLOW-PARSED.json'),JSON.stringify(workflow,null,2)+'\n');
});
