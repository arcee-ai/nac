import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { reverseBrowserApt } from './browser-apt-wiring.mjs';
import { requiredJobs, qualityJobs } from './pr-checks.mjs';

const require=createRequire(import.meta.url),YAML=require('yaml');
const workflow=YAML.parse(fs.readFileSync('.github/workflows/stable-release.yml','utf8'));
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(sort(v))).digest('hex');
// Full pre-relay parsed workflow at exact parent914782659a6183b89070a3516e2e44776b1eeb06.
const parentHash='ae09c30f8765b2116cd9ed25365d2115dffcd7c36630bfa485a4db6e50d19b18';
function validate(value) {
  const old=structuredClone(value);reverseBrowserApt(old);assert.equal(hash(old),parentHash);
  assert.equal(value.permissions.contents,'read');
  for(const role of ['browser-shards','browser-proof']) {
    const job=value.jobs[role];assert.deepEqual(job.needs,['prepare','browser-binary']);
    const normal=job.steps.find(s=>s.name==='Install Playwright Chromium');
    assert.deepEqual(normal,{name:'Install Playwright Chromium','working-directory':'crates/nac-server/web',run:'npx playwright install --with-deps chromium'});
    const fetch=job.steps.find(s=>s.with?.['artifact-ids']==='${{ needs.browser-binary.outputs.apt_artifact_id }}');
    assert.ok(fetch);assert.match(fetch.if,/cold_caches != 'true'/);
    assert.match(job.steps.find(s=>s.id==='apt-consume').run,/--source "\$NAC_SOURCE_REVISION"/);
    const offer=job.steps.find(s=>s.run?.includes('browser-apt.py offer'));
    assert.equal(offer.if,"steps.apt-consume.outputs.mode == 'verified-offer'");
    assert.equal(job.steps.find(s=>s.run?.includes('browser-apt.py cleanup')).if,"always() && steps.apt-preflight.outcome == 'success'");
  }
  assert.deepEqual(value.jobs['browser-shards'].strategy.matrix.shard,[1,2,3,4,5,6,7,8]);
  assert.deepEqual(value.jobs.browser.needs,['prepare','browser-binary','browser-shards','browser-proof']);
  assert.equal(value.jobs['required-pr-checks'].needs.filter(x=>x==='browser-binary').length,1);
  assert.ok(requiredJobs.includes('browser-binary'));assert.ok(!requiredJobs.includes('browser-apt'));
  assert.ok(!qualityJobs.includes('browser-binary'));
  for(const role of ['browser-binary','browser-shards','browser-proof'])
    for(const item of value.jobs[role].steps.filter(s=>s.uses?.startsWith('Swatinem/')))assert.equal(item.with['save-if'],'false');
}

test('exact relay-only AST projection recovers the entire frozen production parent',()=>validate(workflow));
const step=(w,role,id)=>w.jobs[role].steps.find(s=>s.id===id);
const mutations={
  'misleading cold description':w=>w.on.workflow_dispatch.inputs.cold_caches.description='Keep cache hot',
  'no producer output':w=>delete w.jobs['browser-binary'].outputs.apt_receipt,
  'unanchored producer ID':w=>w.jobs['browser-binary'].outputs.apt_artifact_id='0',
  'source drift':w=>step(w,'browser-binary','apt-preflight').run=step(w,'browser-binary','apt-preflight').run.replace('$NAC_SOURCE_REVISION','dev'),
  'missing cold bypass':w=>step(w,'browser-proof','apt-preflight').env.COLD_APT='false',
  'cold artifact read':w=>w.jobs['browser-shards'].steps.find(s=>s.with?.['artifact-ids']?.includes('apt_artifact_id')).if="needs.browser-binary.outputs.apt_mode == 'ready'",
  'missing ID guard':w=>{const s=w.jobs['browser-proof'].steps.find(s=>s.name==='Validate package selection before any download');s.run=s.run.replace('[[ "$APT_ID" =~ ^[1-9][0-9]*$ ]]','true');},
  'missing receipt guard':w=>{const s=w.jobs['browser-proof'].steps.find(s=>s.name==='Validate package selection before any download');s.run=s.run.replace('test -n "$BROWSER_APT_RECEIPT"','true');},
  'existing download leaf':w=>{const s=w.jobs['browser-proof'].steps.find(s=>s.name==='Validate package selection before any download');s.run=s.run.replace('mkdir "$RUNNER_TEMP/browser-apt-download"','mkdir -p "$RUNNER_TEMP/browser-apt-download"');},
  'unconditional root offer':w=>delete w.jobs['browser-proof'].steps.find(s=>s.run?.includes('browser-apt.py offer')).if,
  'success-only cleanup':w=>w.jobs['browser-proof'].steps.find(s=>s.run?.includes('browser-apt.py cleanup')).if='success()',
  'with-deps omitted':w=>w.jobs['browser-proof'].steps.find(s=>s.name==='Install Playwright Chromium').run='npx playwright install chromium',
  'cold test skip':w=>w.jobs['browser-shards'].steps.find(s=>s.name==='Run production-embedded browser shard').if='false',
  'proof binary binding removed':w=>w.jobs['browser-proof'].steps.find(s=>s.run?.includes('verify-proof')).run='true',
  'required join weakened':w=>w.jobs.browser.needs.pop(),
  'extra optional job':w=>w.jobs['browser-apt']={needs:'prepare','runs-on':'ubuntu-latest',steps:[{run:'true'}]},
  'compiler cache save broadened':w=>w.jobs['browser-binary'].steps.find(s=>s.uses?.startsWith('Swatinem/')).with['save-if']='true',
  'permission broadened':w=>w.permissions.actions='write',
  'missing attempt evidence':w=>{const s=w.jobs['browser-binary'].steps.find(s=>s.id==='apt-upload');s.with.name=s.with.name.replace('-${{ github.run_attempt }}','');},
  'duplicate payload evidence':w=>{const s=w.jobs['browser-binary'].steps.at(-1);s.with.path='${{ runner.temp }}/browser-apt/';},
  'ignored relay failure':w=>step(w,'browser-binary','apt-export')['continue-on-error']=true,
};
for(const[name,mutate]of Object.entries(mutations))test(`rejects ${name}`,()=>{
  const changed=structuredClone(workflow);mutate(changed);assert.throws(()=>validate(changed));
});

test('actual parsed cold expression never reads package artifacts in cold mode',()=>{
  const expression=workflow.jobs['browser-proof'].steps.find(s=>s.with?.['artifact-ids']?.includes('apt_artifact_id')).if;
  for(const cold of ['true','false'])for(const mode of ['ready','disabled-cold','nothing-missing','unsupported-platform']) {
    const value=runInNewContext(expression.replace(/\.([A-Za-z_][\w-]*)/g,'["$1"]'),
      {needs:{'browser-binary':{outputs:{apt_mode:mode}},prepare:{outputs:{cold_caches:cold}}}});
    assert.equal(value,mode==='ready'&&cold==='false');
  }
});

test('real preflight cold and unsupported modes perform no native command or snapshot',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nac-apt-preflight-'));
  try {
    const state=path.join(root,'state'),source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const r=spawnSync('python3',['.github/scripts/browser-apt.py','preflight','--state',state,'--source',source,'--cold','true'],
      {encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',GITHUB_REPOSITORY:'arcee-ai/nac',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',ImageOS:'ubuntu26',ImageVersion:'fixture'}});
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(state,'preflight.json'))).mode,'disabled-cold');
    assert.deepEqual(fs.readdirSync(state).sort(),['identity.json','phase-preflight.json','preflight.json']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('real CLI malformed/mismatch/ownership controls and immutable store guards remain in required release checks',()=>{
  for(const filename of ['browser-apt.test.py','apt-archive-store.test.py']) {
    const r=spawnSync('python3',[`.github/scripts/${filename}`,'-v'],
      {encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/\nOK\n/);
  }
  assert.match(fs.readFileSync('Makefile','utf8'),/node --test \.github\/scripts\/pr-\*\.test\.mjs/);
});
