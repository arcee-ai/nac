import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { requiredJobs, managedCallerJobs, requireComplete } from './pr-checks.mjs';
const require = createRequire(import.meta.url);
const workflow = require('yaml').parse(readFileSync('.github/workflows/stable-release.yml', 'utf8'));

test('required workflow-lint runs nominated checkout and no-skip console controls', () => {
  assert.ok(requiredJobs.includes('workflow-lint'));
  assert.ok(workflow.jobs['required-pr-checks'].needs.includes('workflow-lint'));
  const steps = workflow.jobs['workflow-lint'].steps;
  const resolve = steps.findIndex(s => s.id === 'startup-console-source');
  const checkout = steps[resolve + 1], run = steps[resolve + 2];
  assert.ok(resolve > 0);
  assert.equal(steps[resolve].run, 'python3 -B desktop/macos/ci_startup_console_check.py --resolve >> "$GITHUB_OUTPUT"');
  assert.equal(checkout.uses, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
  assert.deepEqual(checkout.with, { ref: '${{ steps.startup-console-source.outputs.revision }}', path: '.startup-console-q', 'persist-credentials': false });
  assert.equal(run.run, 'python3 -B desktop/macos/ci_startup_console_check.py --source-root .startup-console-q');
  for (const step of steps.slice(resolve, resolve + 3)) {
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
  }
});

test('failed or skipped workflow-lint blocks actual required aggregation', () => {
  const needs = Object.fromEntries(requiredJobs.map(job => [job, { result: 'success' }]));
  for (const job of managedCallerJobs) needs[job] = { result: 'skipped' };
  const sha = 'a'.repeat(40);
  needs.prepare.outputs = { sha, run: 'true' };
  requireComplete(needs, 'false', sha);
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.throws(() => requireComplete({ ...needs, 'workflow-lint': { result } }, 'false', sha), /workflow-lint/);
  }
});
