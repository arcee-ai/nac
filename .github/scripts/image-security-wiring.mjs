import assert from 'node:assert/strict';

// ALL-503 changes only this exact inventory flag. Assert its new meaning before
// reversing it; the original full-workflow fingerprints bind every other field.
export function reverseImageApplicability(config) {
  const inventory = config.jobs['build-smoke'].steps.find(step => step.id === 'inventory');
  assert.equal(inventory.run.split(' --collect-applicability').length, 2);
  assert.ok(inventory.run.includes('--inventory-only --collect-applicability \\\n'));
  inventory.run = inventory.run.replace(' --collect-applicability', '');
}

// ALL-505 changes the summary wording, while the real strict exit/row guards
// are exercised by image-workflow and image_ci_report tests. Preserve all other
// summary commands, output paths, conditionals and workflow fields in the hash.
export function reverseStrictImageSummary(config) {
  const summaries = Object.entries(config.jobs).flatMap(([job, value]) =>
    (value.steps ?? []).filter(step => step.name === 'Report exact-image security findings')
      .map(step => ({ job, step })));
  assert.equal(summaries.length, 1);
  assert.ok(['build-smoke', 'strict-scan'].includes(summaries[0].job));
  const summary = summaries[0].step;
  for (const [current, previous] of [
    ["echo '### Strict exact-image security result'", "echo '### Image findings are advisory; enforcement is deferred'"],
    ["echo 'Blocking findings and incomplete scans fail this job. Full findings remain below.'",
     "echo 'CI success does not establish image security clearance. Full findings remain below.'"],
  ]) {
    assert.equal(summary.run.split(current).length, 2);
    summary.run = summary.run.replace(current, previous);
  }
}
