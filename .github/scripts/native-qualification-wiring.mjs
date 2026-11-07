import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Exact additive supplier projection for this owning layer. Native dispatch is
// separate from ordinary CI; unknown inputs or changed jobs cannot be erased.
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

export function reverseNativeQualification(workflow) {
  reverseStartupConsole(workflow);
  if (!workflow.jobs['native-qualification']) return;
  assert.equal(digest(workflow.jobs['native-qualification']), '58805b410886ff3775ce6642e5f2dd664833013a3e4a1006da49931d4f01b5ae', 'reviewed legacy supplier job');
  delete workflow.jobs['native-qualification'];
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ['cold_caches', 'native_qualification', 'lifecycle_custody'].sort());
  const added = {...inputs}; delete added.cold_caches;
  assert.equal(digest(added), '302a539d4e6d93e53f9d51e1749557b8f33ac6e9fa7cbf9c1bcf84f19303fe73', 'reviewed legacy supplier inputs');
  for (const key of Object.keys(added)) delete inputs[key];
}

export function reverseNativeApp(workflow) {
  if (workflow.jobs['startup-panel-policy']) {
    assert.equal(digest(workflow.jobs['startup-panel-policy']), '3702c2c02f38894c5f1023a79429d748853b6e61535dea9e228d6560ece1527f', 'exact required immutable Mac policy job');
    delete workflow.jobs['startup-panel-policy'];
  }
  if (!workflow.jobs.app) return;
  // The dedicated supplier tests check the app's execution and cache policy.
  // Pin its entire reviewed AST before restoring the pre-supplier cache graph.
  assert.equal(digest(workflow.jobs.app), '52a2e84e44eea88bfadce5600bb30ab895bdf860fca52f6c4e01811558c119f0');
  delete workflow.jobs.app;
}
