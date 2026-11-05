import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { requireManagedComplete, managedJobs, requireComplete, requiredJobs, managedCallerJobs } from '../../.github/scripts/pr-checks.mjs';
const require = createRequire(new URL('../../.github/scripts/package.json', import.meta.url));
const YAML = require('yaml'); // Existing locked release-tooling dependency.
const workflow = name => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

test('one loaded build binds the same immutable ID to smoke and scanning', () => {
  const jobs = workflow('managed-image-build').jobs;
  assert.equal(jobs.result.name, 'Managed image checks complete');
  const steps = jobs['build-smoke'].steps;
  const builds = steps.filter(s => s.uses?.startsWith('docker/build-push-action@'));
  assert.equal(builds.length, 1);
  assert.equal(builds[0].with.load, true);
  assert.equal(builds[0].with.push, false);
  const image = steps.find(s => s.id === 'image');
  assert.equal(image.env.BUILT_IMAGE_ID, '${{ steps.build-image.outputs.imageid }}');
  const smoke = steps.find(s => s.id === 'smoke');
  assert.equal(smoke.env.MANAGED_IMAGE, '${{ steps.image.outputs.id }}');
  assert.equal(smoke.env.MANAGED_IMAGE_SKIP_BUILD, '1');
  const scan = steps.find(s => s.name === 'Scan the same tested image with reviewed policy');
  assert.equal(scan.env.IMAGE_ID, smoke.env.MANAGED_IMAGE);
  assert.ok(scan.run.includes('--image "$IMAGE_ID"'));
  assert.ok(scan.run.includes('--source-revision "$SOURCE_SHA"'));
  const inventory = steps.find(s => s.id === 'inventory');
  assert.equal(inventory.env.IMAGE_ID, scan.env.IMAGE_ID);
  assert.equal(inventory.env.SOURCE_SHA, scan.env.SOURCE_SHA);
  assert.equal(inventory.name, 'Inventory the exact tested image');
  assert.ok(inventory.run.includes('--inventory-only'));
  assert.ok(inventory.run.includes('--output image-security-evidence/inventory'));
  assert.ok(scan.run.includes('--bundle image-security-evidence/inventory'));
  assert.ok(scan.run.includes('--output image-security-evidence/security'));
  assert.ok(scan.run.includes('|| scan_status=$?'));
  assert.ok(scan.run.includes('image_ci_report.py --scan-output image-security-evidence/security'));
  assert.ok(scan.run.includes('--scanner-exit "$scan_status" --image "$IMAGE_ID" --source-revision "$SOURCE_SHA"'));
  assert.ok(!scan.run.includes('--inventory-only'));
  assert.ok(scan.if.includes("steps.inventory.outcome == 'success'"));
  assert.ok(steps.indexOf(inventory) > steps.indexOf(smoke));
  assert.ok(steps.indexOf(scan) > steps.indexOf(inventory));
  assert.ok(!steps.some(s => s['continue-on-error']));
  const artifact = steps.find(s => s.with?.name === 'managed-image-security-${{ needs.prepare.outputs.sha }}');
  assert.equal(artifact.if, 'always()');
  assert.equal(artifact.with.path, 'image-security-evidence/');
  assert.equal(artifact.with['retention-days'], 14);
});

test('image policy checkout uses the trusted base and occurs after the image build', () => {
  const steps = workflow('managed-image-build').jobs['build-smoke'].steps;
  const trusted = steps.find(s => s.with?.path === 'trusted-image-policy');
  assert.equal(trusted.with.ref,
    '${{ steps.publication-policy.outputs.sha || needs.prepare.outputs.policy_sha }}');
  assert.equal(trusted.with['persist-credentials'], false);
  assert.equal(trusted.with['fetch-depth'], 0);
  assert.ok(steps.indexOf(trusted) > steps.findIndex(s => s.id === 'build-image'));
});

test('publication uses the source-owned canonical receipt while ordinary events keep their selected pin', () => {
  const managed = workflow('managed-image-build');
  const stable = workflow('stable-release');
  assert.equal(stable.jobs['managed-image'].with.policy_mode, '${{ needs.prepare.outputs.source_policy_mode }}');
  assert.equal(stable.jobs['managed-image'].with.trusted_policy_sha, '${{ needs.prepare.outputs.source_policy_sha }}');
  const prepare = managed.jobs.prepare;
  const select = prepare.steps.find(s => s.id === 'policy');
  assert.ok(select.run.includes('image-policy.mjs select'));
  assert.equal(select.env.REQUESTED_POLICY_MODE, '${{ inputs.policy_mode }}');
  assert.equal(select.env.REQUESTED_POLICY_SHA, '${{ inputs.trusted_policy_sha }}');
  assert.equal(prepare.outputs.policy_mode, '${{ steps.policy.outputs.mode }}');
  const steps = managed.jobs['build-smoke'].steps;
  assert.equal(steps[0].with['fetch-depth'], 0);
  const pin = steps.find(s => s.id === 'publication-policy');
  assert.equal(pin.if, "needs.prepare.outputs.policy_mode == 'publication'");
  assert.ok(pin.run.includes('.github/scripts/publication-policy.mjs resolve'));
  assert.equal(pin.env.REQUESTED_POLICY_SHA, '${{ needs.prepare.outputs.policy_sha }}');
  const scan = steps.find(s => s.name === 'Scan the same tested image with reviewed policy');
  assert.equal(scan.env.NAC_PUBLICATION_POLICY_SHA, '${{ steps.publication-policy.outputs.sha }}');
  assert.ok(scan.run.includes('--publication-policy'));
  assert.ok(scan.run.includes('"${extra[@]}"'));
  assert.ok(!steps.find(s => s.id === 'inventory').run.includes('--publication-policy'));
});

test('failed image work cannot make the managed or overall aggregate green', () => {
  const sha = 'a'.repeat(40);
  const needs = Object.fromEntries(managedJobs.map(job => [job, { result: 'success' }]));
  needs.prepare.outputs = { sha };
  requireManagedComplete(needs, sha);
  const stable = Object.fromEntries([...requiredJobs, ...managedCallerJobs].map(job => [job, { result: 'success' }]));
  stable.prepare.outputs = { sha, run: 'true' };
  stable['managed-image'].outputs = { sha };
  requireComplete(stable, 'true', sha);
  for (const result of ['failure', 'skipped', 'cancelled', undefined]) {
    needs['build-smoke'].result = result;
    assert.throws(() => requireManagedComplete(needs, sha));
    stable.managed = { result };
    assert.throws(() => requireComplete(stable, 'true', sha));
  }
});

test('daily rescan uses trusted dev and retains failing reports', () => {
  const daily = workflow('image-security-rescan');
  assert.ok(daily.on.schedule[0].cron);
  assert.equal(daily.jobs.rescan.steps[0].with.ref, 'dev');
  const steps = daily.jobs.rescan.steps;
  assert.ok(steps.some(s => s.run?.includes('image_rescan.py')));
  assert.ok(steps.some(s => s.run?.includes('image_ci_report.py --scan-output image-rescan-evidence/rescan')));
  assert.equal(steps.at(-1).if, 'always()');
  assert.equal(steps.at(-1).with['retention-days'], 14);
  assert.ok(!steps.some(s => s['continue-on-error']));
});


test('standalone orchestration binds both reusable lanes to its resolved candidate', () => {
  const wrapper = workflow('managed-image');
  const image = wrapper.jobs['build-smoke'];
  const quality = wrapper.jobs.quality;
  assert.equal(wrapper.on.workflow_dispatch, null);
  assert.deepEqual(wrapper.jobs.result.needs, ['prepare', 'quality', 'build-smoke']);
  assert.equal(wrapper.jobs.result.if, '${{ always() }}');
  assert.equal(image.uses, './.github/workflows/managed-image-build.yml');
  assert.equal(quality.uses, './.github/workflows/managed-quality.yml');
  for (const lane of [image, quality]) {
    assert.equal(lane.needs, 'prepare');
    assert.equal(lane.with.source_sha, '${{ needs.prepare.outputs.sha }}');
    assert.equal(lane.if, undefined);
    assert.equal(lane['continue-on-error'], undefined);
  }
  assert.equal(image.with.policy_mode, '${{ needs.prepare.outputs.policy_mode }}');
  assert.equal(image.with.trusted_policy_sha, '${{ needs.prepare.outputs.policy_sha }}');
  assert.equal(quality.with.quality_receipt, '${{ inputs.quality_receipt }}');
  assert.ok(wrapper.jobs.result.steps.at(-1).run.includes('pr-checks.mjs managed-aggregate'));
});

test('image reusable requires contracts and retains an unconditional fail-closed terminal join', () => {
  const image = workflow('managed-image-build');
  assert.equal(image.on.workflow_dispatch, undefined, 'image-only unit is not a standalone acceptance entrypoint');
  assert.equal(image.on.workflow_call.inputs.source_sha.required, true);
  assert.equal(image.on.workflow_call.outputs.sha.value, '${{ jobs.prepare.outputs.sha }}');
  assert.deepEqual(image.jobs['build-smoke'].needs, ['prepare', 'contract']);
  assert.deepEqual(image.jobs.result.needs, ['prepare', 'contract', 'build-smoke']);
  assert.equal(image.jobs.result.if, '${{ always() }}');
  assert.ok(image.jobs.result.steps.at(-1).run.includes('pr-checks.mjs managed-image-aggregate'));
  for (const job of Object.values(image.jobs)) {
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps ?? []) assert.equal(step['continue-on-error'], undefined);
  }
});

test('quality reusable retains full fallback, current-attempt validation and mandatory private faults', () => {
  const quality = workflow('managed-quality');
  assert.equal(quality.on.workflow_dispatch, undefined);
  assert.equal(quality.on.workflow_call.inputs.source_sha.required, true);
  assert.equal(quality.on.workflow_call.inputs.quality_receipt.default, '');
  const steps = quality.jobs.quality.steps;
  assert.equal(steps[0].with.ref, '${{ inputs.source_sha }}');
  const select = steps.find(s => s.id === 'quality-mode');
  assert.equal(select.env.EXPECTED_SHA, '${{ inputs.source_sha }}');
  assert.equal(select.env.QUALITY_RECEIPT, '${{ inputs.quality_receipt }}');
  assert.ok(select.run.includes('pr-checks.mjs quality-mode'));
  const full = steps.find(s => s.run === 'make ci');
  assert.equal(full.if, "steps.quality-mode.outputs.mode == 'full'");
  const fault = steps.find(s => s.run === 'make test-managed-fault-fixture');
  assert.ok(steps.indexOf(fault) > steps.indexOf(full));
  assert.equal(fault.if, undefined);
  assert.equal(fault['continue-on-error'], undefined);
  assert.equal(quality.permissions.contents, 'read');
});
