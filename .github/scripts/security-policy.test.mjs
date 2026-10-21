import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFindings, validatePolicy } from './security-policy.mjs';

const now = new Date('2026-10-21T12:00:00Z');
const exception = {
  advisory: 'GHSA-test-only', package: 'npm:fixture', context: 'crates/nac-server/web/package-lock.json',
  reason: 'Test only; not a production exception', owner: '@fixture-owner',
  linked_issue: 'https://linear.app/example/issue/TEST-1', expires: '2026-10-22T12:00:00Z',
};
const policy = entry => ({ schema_version: 1, exceptions: [entry] });

test('reviewed exception applies only to exact advisory, package, and source/image context', () => {
  const findings = [exception,
    { ...exception, context: '.github/scripts/package-lock.json' },
    { ...exception, context: 'Cargo.lock' },
    { ...exception, context: 'managed-image' },
    { ...exception, package: 'npm:another' },
    { ...exception, advisory: 'GHSA-new' }];
  const result = evaluateFindings(findings, policy(exception), { now });
  assert.equal(result.excepted.length, 1);
  assert.equal(result.blocking.length, 5);
  assert.deepEqual(result.excepted[0].exception, exception);
});

test('missing, malformed, wildcard, unknown, duplicate, and expired policy fail closed', () => {
  for (const invalid of [null, {}, { schema_version: 2, exceptions: [] },
    { schema_version: 1, exceptions: [], ignored_packages: ['fixture'] },
    { schema_version: 1, exceptions: [exception, exception] }]) {
    assert.throws(() => validatePolicy(invalid, { now }));
  }
  for (const field of Object.keys(exception)) {
    const missing = { ...exception };
    delete missing[field];
    assert.throws(() => validatePolicy(policy(missing), { now }));
    assert.throws(() => validatePolicy(policy({ ...exception, [field]: '' }), { now }));
  }
  for (const patch of [{ package: '*' }, { context: 'Cargo.*' }, { advisory: 'GHSA-*' },
    { expires: '2026-10-21T12:00:00Z' }, { expires: '2026-02-30T12:00:00Z' },
    { expires: '2027-01-01' }, { expires: '2027-01-01T00:00:00+00:00' },
    { linked_issue: 'http://example.com/TEST-1' }, { linked_issue: 'https://example.com/' },
    { linked_issue: 'https://user:pass@example.com/TEST-1' }, { extra: 'unknown' }]) {
    assert.throws(() => validatePolicy(policy({ ...exception, ...patch }), { now }));
  }
  assert.throws(() => evaluateFindings([{}], policy(exception), { now }));
});

test('exceptions are revalidated at evaluation time', () => {
  validatePolicy(policy(exception), { now });
  assert.throws(() => evaluateFindings([exception], policy(exception), { now: new Date(exception.expires) }), /expired/u);
});
