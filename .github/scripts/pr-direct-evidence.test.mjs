import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { reverseDirectEvidence } from './direct-evidence-wiring.mjs';

const YAML = createRequire(import.meta.url)('yaml');
const read = name => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const cases = [
  ['stable-release', 'test-workspace', 'Retain managed and direct load evidence'],
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

test('cleanup cannot disappear or move after the fixture', () => {
  for (const [name, job] of cases) {
    const value = read(name);
    const steps = value.jobs[job].steps;
    if (name === 'stable-release') {
      steps.find(s => s.name === 'Preserve source, size, and lifecycle contracts on every PR').run = 'make test-managed-load\n';
    } else {
      const index = steps.findIndex(s => s.name === 'Clear cached private candidate evidence');
      const [clear] = steps.splice(index, 1);
      steps.push(clear);
    }
    assert.throws(() => reverseDirectEvidence(value, name), name);
  }
});
