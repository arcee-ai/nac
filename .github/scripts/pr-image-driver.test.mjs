import { reverseImageApplicability } from './image-security-wiring.mjs';
import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const source = () => YAML.parse(readFileSync('.github/workflows/managed-image-build.yml', 'utf8'));
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');

function verify(value) {
  const config = structuredClone(value); reverseAssetTokens(config);
  reverseImageApplicability(config);
  const steps = config.jobs['build-smoke'].steps;
  const selector = steps.find(s => s.id === 'image-driver');
  assert.deepEqual(selector, {
    name: 'Select supported image build driver', id: 'image-driver',
    run: 'python3 .github/scripts/image-build-driver.py >> "$GITHUB_OUTPUT"',
  });
  const setup = steps.find(s => s.uses?.startsWith('docker/setup-buildx-action@'));
  assert.deepEqual(setup, {
    uses: 'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f', id: 'buildx',
    with: { driver: '${{ steps.image-driver.outputs.driver }}' },
  });
  const build = steps.find(s => s.id === 'build-image');
  assert.equal(build.with.builder, '${{ steps.buildx.outputs.name }}');
  assert.equal(steps.indexOf(selector) + 1, steps.indexOf(setup));
  assert.equal(steps.indexOf(setup) + 1, steps.indexOf(build));
  config.jobs['build-smoke'].steps = steps.filter(s => s !== selector);
  delete setup.id;
  delete setup.with;
  delete build.with.builder;
  // EXACT 62db workflow, including all cold/cache/security/receipt/identity fields.
  assert.equal(digest(config), 'ad745396dfc6813101518ec3c40e7b2a86c8fb368f5380436cb7eb2fb8b11ba5');
}

test('driver selection and explicit builder binding reverse to the exact prior image workflow', () => verify(source()));

test('real selector rejects malformed/unsupported capabilities and emits only known drivers', () => {
  const result = spawnSync('python3', ['.github/scripts/image-build-driver.test.py'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 7 tests/);
  assert.doesNotMatch(result.stderr, /skipped=/);
});

test('selection cannot bypass cold/cache trust, immutable image, security or quality requirements', () => {
  const changes = [
    s => { s.find(v => v.id === 'image-driver').if = '!inputs.cold_caches'; },
    s => { s.find(v => v.id === 'image-driver')['continue-on-error'] = true; },
    s => { s.find(v => v.id === 'image-driver').env = { DRIVER: '${{ inputs.driver }}' }; },
    s => { s.find(v => v.id === 'image-driver').run = 'echo driver=docker >> "$GITHUB_OUTPUT"'; },
    s => { s.find(v => v.id === 'buildx').with.driver = 'docker'; },
    s => { s.find(v => v.id === 'buildx').with['driver-opts'] = 'image=unreviewed'; },
    s => { s.find(v => v.id === 'build-image').with.builder = '${{ inputs.builder }}'; },
    s => { s.find(v => v.id === 'build-image').with['cache-to'] = 'type=gha,mode=max'; },
    s => { s.find(v => v.id === 'build-image').with['cache-from'] = 'type=gha'; },
    s => { s.find(v => v.id === 'build-image').with['no-cache'] = false; },
    s => { s.find(v => v.id === 'build-image').with.load = false; },
    s => { s.find(v => v.id === 'build-image').with.push = true; },
    s => { s.find(v => v.id === 'build-image').with.platforms = 'linux/arm64'; },
    s => { s.find(v => v.id === 'image').env.BUILT_IMAGE_ID = 'mutable:tag'; },
    s => { s.find(v => v.id === 'smoke').if = 'false'; },
    s => { s.find(v => v.id === 'inventory').if = 'false'; },
    s => { s.find(v => v.run?.includes('image_ci_report.py'))['continue-on-error'] = true; },
  ];
  for (const change of changes) {
    const value = source();
    change(value.jobs['build-smoke'].steps);
    assert.throws(() => verify(value));
  }
  for (const change of [
    v => { v.jobs['scanner-qualification'].if = 'false'; },
    v => { v.jobs.result.needs = ['prepare', 'build-smoke']; },
    v => { v.permissions.contents = 'write'; },
  ]) {
    const value = source(); change(value); assert.throws(() => verify(value));
  }
});

const imageEvidenceMutations = [
  steps => { const item = steps.find(step => step.id === 'inventory'); item.run = item.run.replace(' --collect-applicability', ''); },
  steps => { const item = steps.find(step => step.id === 'inventory'); item.run = item.run.replace(' --collect-applicability', ' --collect-applicability --collect-applicability'); },
  steps => { const item = steps.find(step => step.id === 'inventory'); item.run = item.run.replace(' --collect-applicability', ''); steps.find(step => step.name === 'Scan the same tested image with reviewed policy').run += ' --collect-applicability'; },
];

test('image evidence and reporting deltas cannot weaken the original driver contract', () => {
  for (const mutate of imageEvidenceMutations) {
    const value = source(); mutate(value.jobs['build-smoke'].steps);
    assert.throws(() => verify(value));
  }
});
