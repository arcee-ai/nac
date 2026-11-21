import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { reverseDirectEvidence } from './direct-evidence-wiring.mjs';

const YAML = createRequire(import.meta.url)('yaml');
const read = name => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const cases = [
  ['stable-release', 'test-workspace', 'Retain direct load evidence'],
  ['managed-fault', 'fault', 'Retain private candidate fault evidence'],
  ['managed-quality', 'quality', 'Retain standalone private candidate evidence'],
];

test('only exact current-attempt load evidence is removed from historical projections', () => {
  for (const [name, job, artifactName] of cases) {
    reverseDirectEvidence(read(name), name);
    for (const mutate of [
      steps => { steps.find(s => s.name === artifactName).with.path = 'target'; },
      steps => { steps.find(s => s.name === artifactName).if = 'success()'; },
      steps => { steps.find(s => s.name === artifactName).with['if-no-files-found'] = 'ignore'; },
      steps => { steps.push(structuredClone(steps.find(s => s.name === artifactName))); },
      steps => { steps.splice(steps.findIndex(s => s.name === artifactName), 1); },
      steps => { const [artifact] = steps.splice(steps.findIndex(s => s.name === artifactName), 1); steps.unshift(artifact); },
    ]) {
      const value = read(name);
      mutate(value.jobs[job].steps);
      assert.throws(() => reverseDirectEvidence(value, name), name);
    }
  }
});

test('retirement guard is required before the historical workflow projection', () => {
  const value = read('stable-release');
  const lane = value.jobs['test-workspace'].steps.find(s => s.name === 'Preserve source, size, and lifecycle contracts on every PR');
  lane.run = lane.run.replace('test-direct-retirement ', '');
  assert.throws(() => reverseDirectEvidence(value, 'stable-release'));
});

test('cleanup cannot disappear or move after the fixture', () => {
  for (const [name, job] of cases) {
    const value = read(name);
    const steps = value.jobs[job].steps;
    const clearName = name === 'stable-release' ? 'Clear cached load evidence' : 'Clear cached private candidate evidence';
    const index = steps.findIndex(s => s.name === clearName);
    const [clear] = steps.splice(index, 1);
    steps.push(clear);
    assert.throws(() => reverseDirectEvidence(value, name), name);
  }
});

test('cleanup cannot run before cache restoration', () => {
  for (const [name, job] of cases) {
    const value = read(name);
    const steps = value.jobs[job].steps;
    const index = steps.findIndex(s => s.name === (name === 'stable-release' ? 'Clear cached load evidence' : 'Clear cached private candidate evidence'));
    const [clear] = steps.splice(index, 1);
    const cache = steps.findIndex(s => s.uses?.startsWith('Swatinem/rust-cache@'));
    assert.ok(cache >= 0);
    steps.splice(cache, 0, clear);
    assert.throws(() => reverseDirectEvidence(value, name), name);
  }
});

test('cached evidence is never uploaded when an earlier failure skips cleanup', () => {
  for (const [name, job, artifactName] of cases) {
    const value = read(name);
    const steps = value.jobs[job].steps;
    const clear = steps.find(s => s.id === 'evidence_cleanup');
    const artifact = steps.find(s => s.name === artifactName);
    assert.ok(clear && !clear.if?.includes('always()'), `${name}: a prior failure skips cleanup`);
    assert.match(artifact.if, /always\(\) && steps\.evidence_cleanup\.outcome == 'success'/);
    const expression = artifact.if.replace('always()', 'true').replaceAll('steps.quality-mode', "steps['quality-mode']").replaceAll('steps.fault-mode', "steps['fault-mode']");
    const allowed = outcome => vm.runInNewContext(expression, {
      steps: { evidence_cleanup: { outcome }, 'quality-mode': { outputs: { mode: 'full' } }, 'fault-mode': { outputs: { mode: 'full' } } },
    });
    // GitHub expressions permit hyphenated step IDs as property names; adapt
    // just those known IDs for JavaScript evaluation of the actual condition.
    for (const outcome of ['skipped', 'failure', 'cancelled']) {
      assert.equal(allowed(outcome), false, `${name}: ${outcome} cannot publish cached evidence`);
    }
    assert.equal(allowed('success'), true, `${name}: cleanup permits later failure evidence`);
    artifact.if = artifact.if.replace("steps.evidence_cleanup.outcome == 'success' && ", '').replace(" && steps.evidence_cleanup.outcome == 'success'", '');
    assert.throws(() => reverseDirectEvidence(value, name), `${name}: missing outcome gate must be rejected`);
  }
});

test('fault artifact cannot precede the reusable receipt', () => {
  const value = read('managed-fault');
  const steps = value.jobs.fault.steps;
  const [artifact] = steps.splice(steps.findIndex(s => s.name === 'Retain private candidate fault evidence'), 1);
  steps.splice(steps.findIndex(s => s.id === 'receipt'), 0, artifact);
  assert.throws(() => reverseDirectEvidence(value, 'managed-fault'));
});
