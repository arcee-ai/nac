import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const YAML=require('yaml');
const workflow=YAML.parse(fs.readFileSync(new URL('../workflows/apt-archive-reuse-diagnostic.yml',import.meta.url),'utf8'));

function validate(value) {
  assert.deepEqual(value.on,{push:{branches:['codex/all-582-apt-archive-reuse']}});
  assert.deepEqual(value.permissions,{contents:'read'});
  assert.deepEqual(Object.keys(value.jobs),['archive-mechanism']);
  const job=value.jobs['archive-mechanism'];
  assert.equal(job['runs-on'],'ubuntu-latest');
  assert.equal(job['timeout-minutes'],40);
  assert.equal(job.permissions,undefined);
  assert.equal(job.steps.length,6);
  const [checkout,node,npm,image,probe,upload]=job.steps;
  assert.equal(checkout.uses,'actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
  assert.deepEqual(checkout.with,{ref:'${{ github.sha }}','persist-credentials':false});
  assert.equal(node.uses,'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
  assert.deepEqual(node.with,{'node-version':'24.22.1'});
  assert.equal(npm.run,'npm --prefix crates/nac-server/web ci --ignore-scripts');
  assert.equal(image.run,'timeout 180s docker pull docker.io/library/ubuntu@sha256:157dc3d6e4a3e4f2c68d12df9df9ed6e808b59af6d4c3757b432b4f519916725');
  assert.deepEqual(probe.env,{SOURCE_SHA:'${{ github.sha }}'});
  assert.match(probe.run,/test "\$GITHUB_REF" = refs\/heads\/codex\/all-582-apt-archive-reuse/);
  assert.match(probe.run,/test "\$GITHUB_EVENT_NAME" = push/);
  assert.match(probe.run,/apt-archive-experiment\.py/);
  assert.match(probe.run,/--source "\$SOURCE_SHA"/);
  assert.match(probe.run,/--output "\$RUNNER_TEMP\/apt-archive-evidence"/);
  assert.doesNotMatch(probe.run,/sudo|secrets\./);
  assert.equal(upload.if,'always()');
  assert.equal(upload.uses,'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.deepEqual(upload.with,{name:'apt-archive-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
    path:'${{ runner.temp }}/apt-archive-evidence/*','compression-level':0,'retention-days':7,'if-no-files-found':'error'});
}

test('actual diagnostic grants no shared-cache write or ordinary-PR role',()=>validate(workflow));
const mutations={
  'PR trigger':v=>v.on.pull_request={},
  'broader branch':v=>v.on.push.branches.push('dev'),
  'write permission':v=>v.permissions.contents='write',
  'job permission override':v=>v.jobs['archive-mechanism'].permissions={actions:'write'},
  'shared-cache save':v=>v.jobs['archive-mechanism'].steps.push({uses:'actions/cache/save@fake'}),
  'image tag drift':v=>v.jobs['archive-mechanism'].steps[3].run='docker pull ubuntu:latest',
  'source drift':v=>v.jobs['archive-mechanism'].steps[4].env.SOURCE_SHA='dev',
  'secret access':v=>v.jobs['archive-mechanism'].steps[4].env.TOKEN='${{ secrets.TOKEN }}',
  'success-only evidence':v=>delete v.jobs['archive-mechanism'].steps[5].if,
  'missing attempt identity':v=>v.jobs['archive-mechanism'].steps[5].with.name='apt-${{ github.sha }}-${{ github.run_id }}',
};
for (const [name,mutate] of Object.entries(mutations)) test(`rejects ${name}`,()=>{
  const changed=structuredClone(workflow);mutate(changed);assert.throws(()=>validate(changed));
});
