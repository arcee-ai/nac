import assert from 'node:assert/strict';

// ALL-503 changes only this exact inventory flag. Assert its new meaning before
// reversing it; the original full-workflow fingerprints bind every other field.
export function reverseImageApplicability(config) {
  const inventory = config.jobs['build-smoke'].steps.find(step => step.id === 'inventory');
  assert.equal(inventory.run.split(' --collect-applicability').length, 2);
  assert.ok(inventory.run.includes('--inventory-only --collect-applicability \\\n'));
  inventory.run = inventory.run.replace(' --collect-applicability', '');
}
