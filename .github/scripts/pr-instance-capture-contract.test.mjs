import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {reverseNativeQualification} from './native-qualification-wiring.mjs';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const read = () => YAML.parse(readFileSync('.github/workflows/stable-release.yml', 'utf8'));

test('capture-contract CI cannot disappear, move, inherit ambient values or become optional', () => {
  const mutations = [
    steps => { steps.splice(steps.length - 2, 1); },
    steps => { [steps[steps.length - 2], steps[steps.length - 3]] = [steps[steps.length - 3], steps[steps.length - 2]]; },
    steps => { steps.at(-2).env = {NAC_MANAGED_CONFIG: 'ambient'}; },
    steps => { steps.at(-2)['continue-on-error'] = true; },
    steps => { steps.at(-2).run = "python3 -B -m unittest discover -s desktop/macos -p 'test_ci_paths*.py' -v"; },
  ];
  for (const change of mutations) {
    const workflow = read();
    change(workflow.jobs['workflow-lint'].steps);
    assert.throws(() => reverseNativeQualification(workflow));
  }
});
