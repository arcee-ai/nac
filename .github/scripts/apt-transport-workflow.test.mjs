import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const source = YAML.parse(fs.readFileSync(new URL('../workflows/apt-transport-diagnostic.yml', import.meta.url), 'utf8'));

function validate(workflow) {
  assert.deepEqual(workflow.on, { push: { branches: ['codex/all-582-apt-transport-probe'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['paired-transport']);
  const job = workflow.jobs['paired-transport'];
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 40);
  assert.equal(job.steps.length, 3);
  const [checkout, probe, upload] = job.steps;
  assert.equal(checkout.uses, 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262');
  assert.deepEqual(checkout.with, { ref: '${{ github.sha }}', 'persist-credentials': false });
  assert.deepEqual(probe.env, { SOURCE_SHA: '${{ github.sha }}', EXPECTED_REF: 'refs/heads/codex/all-582-apt-transport-probe' });
  assert.match(probe.run, /test "\$GITHUB_REF" = "\$EXPECTED_REF"/);
  assert.match(probe.run, /test "\$GITHUB_EVENT_NAME" = push/);
  assert.match(probe.run, /python3 \.github\/scripts\/apt-transport-native\.py/);
  assert.match(probe.run, /--source "\$SOURCE_SHA"/);
  assert.match(probe.run, /--output "\$RUNNER_TEMP\/apt-transport-evidence"/);
  assert.doesNotMatch(probe.run, /sudo|curl|wget|docker|install|secrets\./);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.deepEqual(upload.with, {
    name: 'apt-transport-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
    path: '${{ runner.temp }}/apt-transport-evidence/*',
    'if-no-files-found': 'error', 'compression-level': 0, 'retention-days': 7,
  });
  assert.equal(job.permissions, undefined);
}

test('actual diagnostic stays private, read-only and run-bound', () => validate(source));
const mutations = {
  'broadened trigger': w => w.on.push.branches.push('dev'),
  'workflow dispatch': w => w.on.workflow_dispatch = {},
  'write permission': w => w.permissions.contents = 'write',
  'job write permission': w => w.jobs['paired-transport'].permissions = { contents: 'write' },
  'cache or install step': w => w.jobs['paired-transport'].steps.push({ run: 'sudo apt-get install fonts-unifont' }),
  'secret environment': w => w.jobs['paired-transport'].steps[1].env.TOKEN = '${{ secrets.TOKEN }}',
  'wrong source': w => w.jobs['paired-transport'].steps[1].env.SOURCE_SHA = 'dev',
  'missing failure evidence': w => delete w.jobs['paired-transport'].steps[2].if,
  'missing run binding': w => w.jobs['paired-transport'].steps[2].with.name = 'apt-${{ github.sha }}-${{ github.run_attempt }}',
  'missing attempt binding': w => w.jobs['paired-transport'].steps[2].with.name = 'apt-${{ github.sha }}-${{ github.run_id }}',
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const changed = structuredClone(source);
    mutate(changed);
    assert.throws(() => validate(changed));
  });
}
