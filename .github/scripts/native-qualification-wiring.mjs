import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Exact additive supplier projection for this owning layer. Native dispatch is
// separate from ordinary CI; unknown inputs or changed jobs cannot be erased.
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reverseNativeQualification(workflow) {
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
  if (!workflow.jobs.app) return;
  // The dedicated supplier tests check the app's execution and cache policy.
  // Pin its entire reviewed AST before restoring the pre-supplier cache graph.
  assert.equal(digest(workflow.jobs.app), '52a2e84e44eea88bfadce5600bb30ab895bdf860fca52f6c4e01811558c119f0');
  delete workflow.jobs.app;
}
