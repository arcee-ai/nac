import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Exact additive supplier projection. Older ordinary CI proofs retain their
// original hashes; this projection cannot discard arbitrary workflow changes.
export const nativeOrdinary = "github.event_name != 'workflow_dispatch' || inputs['native-qualification'] == '' || inputs['native-qualification'] == 'none'";
export const nativeExcludedName = original => "${{ github.event_name == 'workflow_dispatch' && inputs['native-qualification'] != '' && inputs['native-qualification'] != 'none' && 'Native-only aggregate excluded' || " + original.slice(4);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Project only this exact required source-control addition; preserve older CI proofs.
export function reverseStartupConsole(workflow) {
  const steps = workflow.jobs['workflow-lint'].steps;
  const index = steps.findIndex(step => step.id === 'startup-console-source');
  if (index < 0) {
    assert.ok(!steps.some(step => step.run?.includes('ci_startup_console_check.py') || step.with?.path === '.startup-console-q'));
    return;
  }
  assert.deepEqual(steps.slice(index, index + 3), [
    { name: 'Resolve immutable startup console supplier', id: 'startup-console-source',
      run: 'python3 -B desktop/macos/ci_startup_console_check.py --resolve >> "$GITHUB_OUTPUT"' },
    { uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      with: { ref: '${{ steps.startup-console-source.outputs.revision }}', path: '.startup-console-q', 'persist-credentials': false } },
    { name: 'Require startup console producer and collector controls with zero skips',
      run: 'python3 -B -m unittest discover -s desktop/macos -p "test_ci_startup_console_check.py" -v && python3 -B desktop/macos/ci_startup_console_check.py --source-root .startup-console-q' },
  ]);
  steps.splice(index, 3);
}

const jobs = {
  'native-qualification': '30723c5c3423f741df2fea3974feaba0d178033171f67e1705c6b3e08812d40b',
  'native-admission': '2a87a1b238954e08bab65a062fcd2c0fce7ae7c5fa3783a8bbdb66f6e9c772c1',
  'native-exact': '1b63d965b6241e01fa93db8734276b53b3bbac0539bd9a9df27a9238106af0d2',
};
export function reverseNativeQualification(workflow) {
  reverseStartupConsole(workflow);
  if (!Object.keys(jobs).some(id => workflow.jobs[id])) return;
  for (const [id, hash] of Object.entries(jobs)) {
    assert.equal(digest(workflow.jobs[id]), hash, id + ': reviewed supplier job');
    delete workflow.jobs[id];
  }
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ['cold_caches', 'lifecycle_custody', 'native-qualification', 'native-paths-custody', 'native_qualification', 'paths_custody'].sort());
  const added = {...inputs}; delete added.cold_caches;
  assert.equal(digest(added), '3b829efb754305d65b1b0bc355829ac8bf632bed796de0c11bcc835b8a01ca7e', 'reviewed manual input contracts');
  for (const key of Object.keys(added)) delete inputs[key];
  assert.equal(workflow.jobs.prepare.if, '${{ always() && (' + nativeOrdinary + ') }}');
  workflow.jobs.prepare.if = '${{ always() }}';
  const aggregate = workflow.jobs['required-pr-checks'];
  assert.equal(aggregate.if, '${{ always() && (' + nativeOrdinary + ') }}');
  aggregate.if = '${{ always() }}';
  const original = "${{ needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure' && 'NAC metadata checks omitted' || 'Required PR checks' }}";
  assert.equal(aggregate.name, nativeExcludedName(original));
  aggregate.name = original;
  const steps = workflow.jobs['workflow-lint'].steps;
  // This upper slice adds one required portable capture-contract step. Check
  // its complete AST before recovering the predecessor's ordinary-CI proof.
  assert.deepEqual(steps.at(-2), {
    name: 'Check instance capture evidence contracts without native execution',
    run: "python3 -B -m unittest discover -s desktop/macos -p 'test_ci_instance_capture_*.py' -v",
  });
  steps.splice(steps.length - 2, 1);
  assert.deepEqual(steps.at(-2), {
    name: 'Check portable path adapter contracts without native execution',
    run: "python3 -B -m unittest discover -s desktop/macos -p 'test_ci_paths*.py' -v",
  });
  steps.splice(steps.length - 2, 1);
}

export function reverseNativeApp(workflow) {
  if (workflow.jobs['startup-panel-policy']) {
    assert.equal(digest(workflow.jobs['startup-panel-policy']), '1f5773c75a395738d65e4d768fbe8427bea8f0e48b1978fbb9a8265c59cf383e', 'exact required immutable Mac policy job');
    delete workflow.jobs['startup-panel-policy'];
  }
  if (!workflow.jobs.app) return;
  // The dedicated supplier tests check the app's execution and cache policy.
  // Pin its entire reviewed AST before restoring the pre-supplier cache graph.
  assert.equal(digest(workflow.jobs.app), '52a2e84e44eea88bfadce5600bb30ab895bdf860fca52f6c4e01811558c119f0');
  delete workflow.jobs.app;
}
