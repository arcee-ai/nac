import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
  'source alias':w=>w.jobs['payload-only'].steps.at(-2).run=w.jobs['payload-only'].steps.at(-2).run.replace('$GITHUB_SHA','dev'),
  'cache write':w=>w.jobs['payload-only'].steps.push({uses:'actions/cache@'+'a'.repeat(40)}),
  'missing failure evidence':w=>w.jobs['payload-only'].steps.at(-1).if='success()',
  'attempt omission':w=>w.jobs['payload-only'].steps.at(-1).with.name='private-apt-race-${{ github.sha }}-${{ github.run_id }}',
}))test(`rejects ${name}`,()=>{
  const changed=structuredClone(value);mutate(changed);assert.throws(()=>validate(changed));
});

test('production workflow and authority owners remain exact bytes at base5603',()=>{
  // Exact unchanged-file fence, not a normalization/projection or verdict reuse.
  const pins=JSON.parse(fs.readFileSync('docs/ci/evidence/all-582/apt-race-production-fence.json','utf8'));
  for(const[file,digest]of Object.entries(pins.files))
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,file);
});
