import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateImage } from './image-policy.mjs';

const options = { now: new Date('2026-10-21T00:00:00Z') };
const finding = { advisory: 'CVE-2026-1234', package: 'binary:node', context: 'managed-image', severity: 'High' };
const exception = { ...finding, reason: 'Time bounded remediation', owner: 'security-owner',
  linked_issue: 'https://linear.app/arcee/issue/ALL-447', expires: '2026-10-22T00:00:00Z' };
delete exception.severity;
const policy = { schema_version: 1, exceptions: [] };

test('High/Critical block; lower severities stay in the report; unknown fails closed', () => {
  const findings = ['Negligible', 'Low', 'Medium', 'High', 'Critical', 'Unknown'].map(severity => ({ ...finding, severity }));
  const result = evaluateImage(findings, policy, options);
  assert.deepEqual(result.blocking.map(f => f.severity), ['High', 'Critical', 'Unknown']);
  assert.deepEqual(result.reporting.map(f => f.severity), ['Negligible', 'Low', 'Medium']);
});

test('trusted exact image exception applies, source or different package exception cannot', () => {
  for (const entry of [{ ...exception, context: 'Cargo.lock' }, { ...exception, context: '.github/scripts/package-lock.json' },
    { ...exception, package: 'npm:node' }]) {
    assert.equal(evaluateImage([finding], { ...policy, exceptions: [entry] }, options).blocking.length, 1);
  }
  assert.equal(evaluateImage([finding], { ...policy, exceptions: [exception] }, options).excepted.length, 1);
});

test('expired or malformed exception fails even with a safe empty result', () => {
  for (const entry of [{ ...exception, expires: '2026-10-20T00:00:00Z' }, { ...exception, owner: '' }]) {
    assert.throws(() => evaluateImage([], { ...policy, exceptions: [entry] }, options));
  }
});

test('an unchanged SBOM finding added by a new DB blocks the next evaluation', () => {
  assert.equal(evaluateImage([], policy, options).blocking.length, 0);
  assert.equal(evaluateImage([finding], policy, options).blocking.length, 1);
});
