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
  'native-qualification': '59074d1a5f83fca79781eea95769cf04733512598428857eb4b010c83e6b61f5',
  'native-admission': '2a87a1b238954e08bab65a062fcd2c0fce7ae7c5fa3783a8bbdb66f6e9c772c1',
  'native-exact': '1b63d965b6241e01fa93db8734276b53b3bbac0539bd9a9df27a9238106af0d2',
};
export function reverseNativeQualification(workflow) {
  if (workflow.jobs['local-network-diagnostic']) {
    // The experimental branch-only dispatch is an exact additive overlay.
    // Refuse every change before projecting it out of ordinary-CI proofs.
    assert.equal(digest(workflow.jobs['local-network-diagnostic']), 'f5a32bb9bc6e14ecc6796fc3637e057f7f34c11145dc244c1b9c394d5ceddace');
    delete workflow.jobs['local-network-diagnostic'];
    const admission = "github.event_name == 'workflow_dispatch' && inputs['native-qualification'] != '' && inputs['native-qualification'] != 'none'";
    assert.equal(workflow.jobs['native-admission'].if, '${{ ' + admission + " && !(github.ref == 'refs/heads/codex/all616-local-network-diagnostic' && inputs['native-paths-custody'] == 'local-network-diagnostic-v1') }}");
    workflow.jobs['native-admission'].if = '${{ ' + admission + ' }}';
  }
  reverseStartupConsole(workflow);
  if (!Object.keys(jobs).some(id => workflow.jobs[id])) return;
  for (const [id, hash] of Object.entries(jobs)) {
    assert.equal(digest(workflow.jobs[id]), hash, id + ': reviewed supplier job');
    delete workflow.jobs[id];
  }
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(), ['cold_caches', 'lifecycle_custody', 'native-qualification', 'native-paths-custody', 'native_qualification', 'paths_custody', 'startup_product_sha'].sort());
  const added = {...inputs}; delete added.cold_caches;
  assert.equal(digest(added), '5313e3f2a7fbffae308d779bfb8b915d7826dd0367aaa0c9fd19b3373128c4d8', 'reviewed manual input contracts');
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
  if (workflow.jobs.electron) {
    // Only the reviewed additive ordinary Electron lane may be projected away;
    // predecessor admission/cache/security fingerprints remain authoritative.
    assert.equal(digest(workflow.jobs.electron), 'e6bdbc597dc41c46d2aa2ac10d908915f3417b1df9c0c70655398172e2e94582', 'exact required normal Electron job');
    delete workflow.jobs.electron;
  }
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
