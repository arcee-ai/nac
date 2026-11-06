import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const YAML=createRequire(import.meta.url)('yaml');
const value=YAML.parse(fs.readFileSync('.github/workflows/apt-race-pilot.yml','utf8'));
function validate(w) {
  assert.deepEqual(w.on,{push:{branches:['codex/all-582-apt-race-pilot-20261106']}});
  assert.deepEqual(w.permissions,{contents:'read'});
  assert.deepEqual(w.concurrency,{group:'private-apt-race-${{ github.ref }}','cancel-in-progress':false});
  assert.deepEqual(Object.keys(w.jobs),['payload-only']);
  const job=w.jobs['payload-only'];
  assert.equal(job['runs-on'],'ubuntu-latest');
  assert.equal(job['timeout-minutes'],40);
  assert.deepEqual(job.steps[0],{name:'Anchor the absolute infrastructure budget before any setup',
    run:'echo "PILOT_JOB_STARTED=$(date +%s)" >> "$GITHUB_ENV"'});
  assert.equal(job.strategy,undefined);
  const setup=job.steps.find(s=>s.uses?.startsWith('actions/checkout@'));
  assert.equal(setup.with['persist-credentials'],false);
  const native=job.steps.find(s=>s.run?.includes('apt-race-pilot.py --source'));
  assert.deepEqual(native,{name:'One full dynamic-plan baseline and two-route acquisition comparison',
    run:'python3 .github/scripts/apt-race-pilot.py --source "$GITHUB_SHA" --output "$RUNNER_TEMP/apt-race-evidence"'});
  const controls=job.steps.find(s=>s.name==='Offline admission, result-rule and actual GNU lease controls');
  assert.equal(controls.shell,'bash');
  assert.ok(controls.run.startsWith('set -euo pipefail\n'));
  assert.equal(controls.if,undefined);
  for(const step of job.steps) {
    assert.equal(step['continue-on-error'],undefined);
    assert.equal(step.run?.includes('sudo'),step.run?false:undefined);
    assert.ok(!step.uses || /^actions\/(?:checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/.test(step.uses));
    assert.ok(!/cache|upload-pages|github-script/i.test(step.uses??''));
  }
  const evidence=job.steps.at(-1);
  assert.equal(evidence.if,'always()');
  assert.equal(evidence.with['if-no-files-found'],'error');
  assert.equal(evidence.with.name,'private-apt-race-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}');
}
test('only one private payload runner with complete original native bounds and no writes',()=>validate(value));
for(const[name,mutate]of Object.entries({
  'PR traffic':w=>w.on.pull_request={},
  'branch broadening':w=>w.on.push.branches=['**'],
  'token write':w=>w.permissions.actions='write',
  'concurrent VM':w=>delete w.concurrency,
  'second VM':w=>w.jobs.other=structuredClone(w.jobs['payload-only']),
  'short budget':w=>w.jobs['payload-only']['timeout-minutes']=6,
  'late job clock':w=>w.jobs['payload-only'].steps.shift(),
  'ignored error':w=>w.jobs['payload-only'].steps.at(-2)['continue-on-error']=true,
  'unspecified control shell':w=>delete w.jobs['payload-only'].steps.find(s=>s.shell==='bash').shell,
  'missing explicit pipefail':w=>{const s=w.jobs['payload-only'].steps.find(s=>s.shell==='bash');s.run=s.run.replace('set -euo pipefail\n','');},
  'source alias':w=>w.jobs['payload-only'].steps.at(-2).run=w.jobs['payload-only'].steps.at(-2).run.replace('$GITHUB_SHA','dev'),
  'cache write':w=>w.jobs['payload-only'].steps.push({uses:'actions/cache@'+'a'.repeat(40)}),
  'missing failure evidence':w=>w.jobs['payload-only'].steps.at(-1).if='success()',
  'attempt omission':w=>w.jobs['payload-only'].steps.at(-1).with.name='private-apt-race-${{ github.sha }}-${{ github.run_id }}',
}))test(`rejects ${name}`,()=>{
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>validate(changed));
});

test('execute parsed control pipelines: failing Python or Node stops later work; original shell loses failure',t=>{
  const step=value.jobs['payload-only'].steps.find(s=>s.name==='Offline admission, result-rule and actual GNU lease controls');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'apt-race-shell-'));
  try {
    const bin=path.join(root,'bin');fs.mkdirSync(bin);
    for(const name of ['python3','node'])fs.writeFileSync(path.join(bin,name),
      `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$CALLS"\nprintf '%s\\n' 'controlled producer output'\nif [ "$FAIL_PRODUCER" = '${name}' ]; then exit 17; fi\n`,{mode:0o700});
    function execute(label,fail,original=false) {
      const directory=path.join(root,label);fs.mkdirSync(directory);
      const script=path.join(directory,'step.sh'),marker=path.join(directory,'later-work');
      fs.writeFileSync(script,(original?step.run.replace(/^set -euo pipefail\n/,''):step.run)+
        '\nprintf later-work > "$LATER_MARKER"\n');
      // Official unspecified Linux shell is bash -e; explicit bash adds pipefail.
      const args=original?['-e',script]:['--noprofile','--norc','-eo','pipefail',script];
      const result=spawnSync('bash',args,{encoding:'utf8',env:{...process.env,
        PATH:bin+path.delimiter+process.env.PATH,FAIL_PRODUCER:fail,CALLS:path.join(directory,'calls'),
        APT_RACE_CONTROL_EVIDENCE:path.join(directory,'evidence'),LATER_MARKER:marker}});
      assert.equal(result.error,undefined);
      return {status:result.status,later:fs.existsSync(marker),calls:fs.readFileSync(path.join(directory,'calls'),'utf8')};
    }
    const observed={};
    for(const fail of ['python3','node']) {
      const current=execute(fail,fail);
      observed[fail]=current;
      assert.equal(current.status,17);assert.equal(current.later,false);
      if(fail==='python3')assert.equal(current.calls,'python3\n');
    }
    assert.equal(execute('both-pass','').later,true);
    const original=execute('original-gap','python3',true);
    assert.equal(original.status,0);assert.equal(original.later,true);
    t.diagnostic(JSON.stringify({...observed,original}));
  } finally {fs.rmSync(root,{recursive:true});}
});

test('production workflow and authority owners remain exact bytes at base5603',()=>{
  // Exact unchanged-file fence, not a normalization/projection or verdict reuse.
  const pins=JSON.parse(fs.readFileSync('docs/ci/evidence/all-582/apt-race-production-fence.json','utf8'));
  for(const[file,digest]of Object.entries(pins.files))
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,file);
});
