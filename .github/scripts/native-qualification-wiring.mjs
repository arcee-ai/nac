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
  assert.equal(digest(workflow.jobs['native-qualification']), 'ccd4511dc32a25279e7ab64a00400b2613cbda67d5d71c834925d926af79a6a9', 'reviewed legacy supplier job');
  delete workflow.jobs['native-qualification'];
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ['cold_caches', 'native_qualification'].sort());
  const added = {...inputs}; delete added.cold_caches;
  assert.equal(digest(added), '6df9104aca0aed2f7cd7d9082023b04f43468408d3ea28aca3a41bab32a232ad', 'reviewed legacy supplier inputs');
  for (const key of Object.keys(added)) delete inputs[key];
}

export function reverseNativeApp(workflow) {
  if (!workflow.jobs.app) return;
  // The dedicated supplier tests check the app's execution and cache policy.
  // Pin its entire reviewed AST before restoring the pre-supplier cache graph.
  assert.equal(digest(workflow.jobs.app), '52a2e84e44eea88bfadce5600bb30ab895bdf860fca52f6c4e01811558c119f0');
  delete workflow.jobs.app;
}
