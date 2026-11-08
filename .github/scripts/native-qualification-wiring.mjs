import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Exact additive supplier projection for this owning layer. Native dispatch is
// separate from ordinary CI; unknown inputs or changed jobs cannot be erased.
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reverseNativeQualification(workflow) {
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
