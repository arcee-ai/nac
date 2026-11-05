import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const YAML = require('yaml');
const workflow = YAML.parse(fs.readFileSync(new URL('../workflows/image-incremental-proof.yml', import.meta.url), 'utf8'));
const action = YAML.parse(fs.readFileSync(new URL('../actions/image-incremental-proof/action.yml', import.meta.url), 'utf8'));

function validate(w) {
  assert.deepEqual(w.on, { push: { branches: ['codex/all-582-image-incremental-proof'] } });
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.equal(w.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(w.jobs), ['four-arms']);
  const job = w.jobs['four-arms'];
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 80);
  assert.equal(job.permissions, undefined);
  const [checkout, node, admission, builder, proof, upload] = job.steps;
  assert.equal(job.steps.length, 6);
  assert.equal(checkout.uses, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
  assert.deepEqual(checkout.with, { ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false });
  assert.equal(node.uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
  assert.deepEqual(node.with, { 'node-version': '24.22.1' });
  assert.match(admission.run, /grep -Fx 'driver=docker'/);
  assert.equal(builder.uses, 'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f');
  assert.deepEqual(builder.with, { driver: 'docker' });
  assert.equal(proof.uses, './.github/actions/image-incremental-proof');
  assert.deepEqual(proof.env, { EXPECTED_CONTROLLER_SHA: '${{ github.sha }}', PROOF_BUILDER: '${{ steps.builder.outputs.name }}' });
  assert.equal(upload.if, 'always()');
  assert.equal(upload.uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.equal(upload.with.name, 'image-incremental-proof-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.match(upload.with.path, /runner.temp/);
  assert.match(upload.with.path, /!.*\/root\/\*\*/);
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['compression-level'], 0);
  assert.equal(upload.with['retention-days'], 7);
  assert.doesNotMatch(JSON.stringify(w), /secrets\.|cache-to|registry|sudo|prune|buildkit-cache-dance/);
  assert.deepEqual(action.runs, { using: 'node24', main: 'run.mjs' });
}
test('actual private proof is narrow and source/run/attempt bound', () => validate(workflow));
for (const [name, mutate] of Object.entries({
  'extra event': w => { w.on.workflow_dispatch = {}; },
  'default branch': w => w.on.push.branches.push('dev'),
  'write token': w => { w.permissions.contents = 'write'; },
  'job write token': w => { w.jobs['four-arms'].permissions = { contents: 'write' }; },
  'paid runner': w => { w.jobs['four-arms']['runs-on'] = 'larger-runner'; },
  'secret handoff': w => { w.jobs['four-arms'].steps[4].env.TOKEN = '${{ secrets.TOKEN }}'; },
  'missing failure upload': w => { delete w.jobs['four-arms'].steps[5].if; },
  'unbound controller': w => { w.jobs['four-arms'].steps[4].env.EXPECTED_CONTROLLER_SHA = 'dev'; },
  'attempt-free artifact': w => { w.jobs['four-arms'].steps[5].with.name = 'image-${{ github.sha }}-${{ github.run_id }}'; },
})) test(`rejects ${name}`, () => {
  const changed = structuredClone(workflow); mutate(changed); assert.throws(() => validate(changed));
});
