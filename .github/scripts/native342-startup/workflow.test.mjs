import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const YAML = require('yaml'); // Existing locked workflow-tooling dependency.
const workflow = YAML.parse(fs.readFileSync('.github/workflows/stable-release.yml', 'utf8'));
const job = workflow.jobs.four_startup;
const initial = job.steps[0].run.split('\n').slice(1, -2).join('\n');
const roots = { DOWNLOAD_ROOT: 'native342-download', PACKAGE_ROOT: 'native342-package', OUTPUT_ROOT: 'native342-episode' };

function initialGate({ image = '20261102.0473.1', now = 1100, clock = {}, tempName = 'runner temp', alias = false, declaration = {} } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-workflow-context-'));
  try {
    const actualTemp = path.join(fixture, tempName);
    fs.mkdirSync(actualTemp);
    const runnerTemp = alias ? path.join(fixture, 'runner-alias') : actualTemp;
    if (alias) fs.symlinkSync(actualTemp, runnerTemp);
    const environment = path.join(fixture, 'github-env');
    const output = path.join(fixture, 'github-output');
    const admission = { scope: 'P12-integration-Qfailure-lifecycle-R7325-four-startup-source15', controller_sha: 'a'.repeat(40),
      allocation_id: 'inert-workflow-source-control', attempt: 1, retries: 0, manifest_sha256: 'b1fb601ed4118029d538d0b9c673ecb927426a13651cb50a1befa279ed8cf70e',
      producer: { run_id:42455455480, artifact_id:13607980704, controller_sha:'0210a3c52062ec28e9c6ae74098040e432e09a65', branch:'codex/experimental-native-p12-lifecycle-package-20261108', artifact_name:'ff8-host-package-42455455480-1' }, clock: { STARTED: 1000, WORK_DEADLINE: 3880, CLEANUP_DEADLINE: 4480, HARD_DEADLINE: 4600, ...clock }, ...declaration };
    // Execute only the actual initial inline Python, with a fixed wall clock.
    // No checkout, compiler, network, H import, app, or case is invoked.
    const result = spawnSync('python3', ['-B', '-c', `import time; time.time=lambda: ${now}; exec(${JSON.stringify(initial)})`], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_ENV: environment, GITHUB_OUTPUT: output,
        GITHUB_SHA: admission.controller_sha, ImageVersion: image, ROOT_STARTUP_ADMISSION: JSON.stringify(admission) },
    });
    assert.equal(result.error, undefined);
    const report = JSON.parse(fs.readFileSync(path.join(actualTemp, 'native342-startup-gate/initial.json'), 'utf8'));
    const exports = fs.existsSync(environment) ? fs.readFileSync(environment, 'utf8') : '';
    return { status: result.status, stderr: result.stderr, report, exports,
      canonicalTemp: fs.realpathSync(actualTemp), output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test('admitted initial gate exports the three fixed canonical roots for later steps', () => {
  for (const alias of [false, true]) {
    const result = initialGate({ alias });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.status, 'PASS');
    assert.equal(result.output, 'minutes=1\n');
    const exported = Object.fromEntries(result.exports.trim().split('\n').map(line => {
      const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
    }));
    assert.deepEqual(exported, Object.fromEntries(Object.entries(roots).map(([key, suffix]) => [key, path.join(result.canonicalTemp, suffix)])));
    assert.equal(new Set(Object.values(exported)).size, 3);
    for (const key of Object.keys(roots)) assert.equal(job.env[key], undefined);
  }
});

test('rejected image, original clock, or multiline root never exports launch roots', () => {
  for (const input of [{ image: '20261026.0455.2' }, { image: '' }, { now: 3880 },
    { clock: { CLEANUP_DEADLINE: 4479 } }, { tempName: 'runner\ninjected' },
    { declaration: { producer: {} } }, { declaration: { manifest_sha256: '0'.repeat(64) } }]) {
    const result = initialGate(input);
    assert.notEqual(result.status, 0);
    assert.equal(result.exports, '');
    assert.equal(result.output, '');
    assert.equal(result.report.status, 'FAIL');
    assert.equal(result.report.compile, false);
    assert.equal(result.report.runtime, false);
  }
});


test('only the new manual four-case source is reachable and independent R is checked out', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.jobs), ['four_startup']);
  assert.match(job.if, /refs\/heads\/codex\/private520-failure-lifecycle-C15/);
  assert.match(job.if, /github.run_attempt == 1/);
  assert.equal(job['timeout-minutes'], 60);
  assert.equal(job.env.ROOT_STARTUP_ADMISSION, '${{ inputs.startup_admission }}');
  assert.equal(job.env.R_ROOT, '${{ github.workspace }}/protocol');
  const checkouts = job.steps.filter(s => s.uses?.startsWith('actions/checkout@'));
  assert.deepEqual(checkouts.map(s => s.with.path), ['controller', 'harness', 'product', 'query', 'protocol']);
  assert.equal(checkouts[4].with.ref, '${{ steps.checkout_H.outputs.R }}');
  assert.ok(checkouts.every(s => s.with['persist-credentials'] === false));
  assert.ok(job.steps.some(s => s.run?.endsWith('/four-startup.py')));
  assert.ok(!job.steps.some(s => /qualify\(|prepare-engine|rust-cache|one-onboarding.py/.test(s.run || s.uses || '')));
});
