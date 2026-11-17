// Authenticate and reverse only ALL-612's artifact-retention wiring before
// applying older frozen workflow projections. Never normalize arbitrary steps.
import assert from 'node:assert/strict';

const upload = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const path = 'target/direct-load/private-candidate-child-read.json';
const full = "steps.quality-mode.outputs.mode == 'full' || steps.fault-mode.outputs.mode == 'full'";

function removeExact(steps, expected) {
  const matches = steps.filter(step => step.name === expected.name);
  assert.equal(matches.length, 1, `expected exactly one ${expected.name}`);
  assert.deepEqual(matches[0], expected);
  const index = steps.indexOf(matches[0]);
  steps.splice(index, 1);
  return index;
}

export function reverseDirectEvidence(workflow, name) {
  if (name === 'stable-release') {
    const steps = workflow.jobs['test-workspace'].steps;
    const lane = steps.find(step => step.name === 'Preserve source, size, and lifecycle contracts on every PR');
    assert.deepEqual(lane, {
      name: 'Preserve source, size, and lifecycle contracts on every PR',
      run: 'rm -rf target/managed-load target/direct-load\nmake test-nac-guide\nmake test-source-size test-source-workflow test-source-binary\nmake test-durability test-managed-load test-managed-image-contract\n',
    });
    const removed = removeExact(steps, {
      name: 'Retain managed and direct load evidence', if: 'always()', uses: upload,
      with: { name: 'load-evidence-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}', path: 'target/managed-load\ntarget/direct-load\n', 'retention-days': 14, 'if-no-files-found': 'warn' },
    });
    assert.equal(removed, steps.indexOf(lane) + 1);
    lane.run = lane.run.replace('rm -rf target/managed-load target/direct-load\n', '');
    return;
  }
  assert.ok(name === 'managed-fault' || name === 'managed-quality');
  const steps = workflow.jobs[name === 'managed-fault' ? 'fault' : 'quality'].steps;
  const fixture = steps.find(step => step.run === 'make test-managed-fault-fixture');
  assert.ok(fixture, 'private fixture must remain');
  const clear = name === 'managed-fault'
    ? { name: 'Clear cached private candidate evidence', run: `rm -f ${path}` }
    : { name: 'Clear cached private candidate evidence', if: full, run: `rm -f ${path}` };
  const clearIndex = removeExact(steps, clear);
  assert.equal(clearIndex, steps.indexOf(fixture));
  const artifact = name === 'managed-fault'
    ? { name: 'Retain private candidate fault evidence', if: 'always()', uses: upload,
        with: { name: 'private-fault-${{ inputs.source_sha }}-${{ github.run_id }}-${{ github.run_attempt }}', path, 'if-no-files-found': 'warn', 'retention-days': 14 } }
    : { name: 'Retain standalone private candidate evidence', if: `always() && (${full})`, uses: upload,
        with: { name: 'standalone-private-fault-${{ inputs.source_sha }}-${{ github.run_id }}-${{ github.run_attempt }}', path, 'if-no-files-found': 'warn', 'retention-days': 14 } };
  const artifactIndex = removeExact(steps, artifact);
  if (name === 'managed-fault') {
    const receiptIndex = steps.findIndex(step => step.id === 'receipt');
    assert.ok(receiptIndex > steps.indexOf(fixture));
    assert.equal(artifactIndex, receiptIndex + 1);
  } else {
    assert.equal(artifactIndex, steps.indexOf(fixture) + 1);
  }
}
