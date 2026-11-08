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
const job = workflow.jobs.lifecycle_transactions;
const initial = job.steps[0].run.split('\n').slice(1, -2).join('\n');
const roots = { DOWNLOAD_ROOT: 'native344-download', LIFECYCLE_OUTPUT: 'native344-episode', PRODUCER_RUN_METADATA: 'native344-lifecycle-gate/producer-run.json', PRODUCER_ARTIFACT_METADATA: 'native344-lifecycle-gate/producer-artifact.json' };

function initialGate({ image = '20261102.0473.1', now = 1100, clock = {}, tempName = 'runner temp', alias = false, declaration = {} } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-workflow-context-'));
  try {
    const actualTemp = path.join(fixture, tempName);
    fs.mkdirSync(actualTemp);
    const runnerTemp = alias ? path.join(fixture, 'runner-alias') : actualTemp;
    if (alias) fs.symlinkSync(actualTemp, runnerTemp);
    const environment = path.join(fixture, 'github-env');
    const output = path.join(fixture, 'github-output');
    const admission = { scope: 'P12-maintained-three-case-lifecycle-transactions-source01', controller_sha: 'a'.repeat(40),
      H: '29931101ff7ad50bfc80bf048681ab05de028ec6', P: '4b7a1f3e0bf6175a77c5ebf627fe965860e99976', role: 'canonical-lifecycle-fixture-v1',
      admission_nonce: 'e'.repeat(64), prior_dispatch_counts: {run:0, approval:0, terminal:0}, allocation_id: 'inert-workflow-source-control', attempt: 1, retries: 0, manifest_sha256: '1ddcf153b7dabeb82b3e662b8770ab57ea734566343e16496c4932c72391cf78',
      producer: { run_id:42455455480, artifact_id:13607980704, controller_sha:'0210a3c52062ec28e9c6ae74098040e432e09a65', branch:'codex/experimental-native-p12-lifecycle-package-20261108', artifact_name:'ff8-host-package-42455455480-1' }, clock: { STARTED: 1000, WORK_DEADLINE: 3880, CLEANUP_DEADLINE: 4480, HARD_DEADLINE: 4600, ...clock }, ...declaration };
    // Execute only the actual initial inline Python, with a fixed wall clock.
    // No checkout, compiler, network, H import, app, or case is invoked.
    const result = spawnSync('python3', ['-B', '-c', `import time; time.time=lambda: ${now}; exec(${JSON.stringify(initial)})`], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_ENV: environment, GITHUB_OUTPUT: output,
        GITHUB_SHA: admission.controller_sha, ImageVersion: image, ROOT_LIFECYCLE_ADMISSION: JSON.stringify(admission) },
    });
    assert.equal(result.error, undefined);
    const report = JSON.parse(fs.readFileSync(path.join(actualTemp, 'native344-lifecycle-gate/initial.json'), 'utf8'));
    const exports = fs.existsSync(environment) ? fs.readFileSync(environment, 'utf8') : '';
    return { status: result.status, stderr: result.stderr, report, exports,
      canonicalTemp: fs.realpathSync(actualTemp), output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test('admitted initial gate exports the four fixed canonical roots for later steps', () => {
  for (const alias of [false, true]) {
    const result = initialGate({ alias });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.status, 'PASS');
    assert.equal(result.output, 'minutes=1\n');
    const exported = Object.fromEntries(result.exports.trim().split('\n').map(line => {
      const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
    }));
    assert.deepEqual(exported, Object.fromEntries(Object.entries(roots).map(([key, suffix]) => [key, path.join(result.canonicalTemp, suffix)])));
    assert.equal(new Set(Object.values(exported)).size, 4);
    for (const key of Object.keys(roots)) assert.equal(job.env[key], undefined);
  }
});

test('rejected image, original clock, or multiline root never exports launch roots', () => {
  for (const input of [{ image: '20261026.0455.2' }, { image: '' }, { now: 3880 },
    { clock: { CLEANUP_DEADLINE: 4479 } }, { tempName: 'runner\ninjected' },
    { declaration: { H: 'b'.repeat(40) } }, { declaration: { P: 'b'.repeat(40) } }, { declaration: { role: 'normal-app-preparation' } }, { declaration: { prior_dispatch_counts: {run:false, approval:0, terminal:0} } }, { declaration: { producer: {} } }, { declaration: { manifest_sha256: '0'.repeat(64) } }]) {
    const result = initialGate(input);
    assert.notEqual(result.status, 0);
    assert.equal(result.exports, '');
    assert.equal(result.output, '');
    assert.equal(result.report.status, 'FAIL');
    assert.equal(result.report.compile, false);
    assert.equal(result.report.runtime, false);
  }
});


test('private first-manual branch, original supplier, runtime entry and evidence only', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(job['runs-on'], 'macos-26');
  assert.equal(job['timeout-minutes'], 60);
  assert.match(job.if, /experimental-native-p12-lifecycle-consumer-source01/);
  assert.match(job.if, /github.run_attempt == 1/);
  assert.deepEqual(workflow.permissions, {contents:'read', actions:'read'});
  const checkouts = job.steps.filter(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 3);
  assert.equal(checkouts[0].with['fetch-depth'], 2);
  assert.deepEqual(checkouts.slice(1).map(s => s.with.ref), [
    '29931101ff7ad50bfc80bf048681ab05de028ec6', '4b7a1f3e0bf6175a77c5ebf627fe965860e99976']);
  for (const step of job.steps.filter(s => s.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/);
  const download = job.steps.find(s => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with['artifact-ids'], 13607980704);
  assert.equal(download.with['run-id'], 42455455480);
  assert.equal(download.with.repository, 'arcee-ai/nac');
  const actual = job.steps.find(s => s.run?.includes('native344-lifecycle/episode.py'));
  assert.ok(actual);
  assert.match(actual['timeout-minutes'], /steps.episode.outputs.minutes/);
  const upload = job.steps.find(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.match(upload.if, /always\(\)/);
  assert.match(upload.with.path, /native344-episode\/evidence/);
  assert.doesNotMatch(upload.with.path, /package|profile|raw/);
});

test('actual always-retention inline preserves the original hard cutoff', () => {
  const step = job.steps.find(s => s.id === 'retention');
  const code = step.run.split('\n').slice(1, -2).join('\n');
  for (const [now, clock, expected] of [
    [4480, {STARTED:1000,HARD_DEADLINE:4600}, 1],
    [4590, {STARTED:1000,HARD_DEADLINE:4600}, 0],
    [4600, {STARTED:1000,HARD_DEADLINE:4600}, 0],
    [1100, {STARTED:1000,HARD_DEADLINE:5000}, 0],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-lifecycle-retention-'));
    try {
      const output = path.join(root, 'output');
      const result = spawnSync('python3', ['-B','-c',`import time; time.time=lambda: ${now}; exec(${JSON.stringify(code)})`], {
        encoding:'utf8', timeout:5000,
        env:{...process.env, GITHUB_OUTPUT:output, ROOT_LIFECYCLE_ADMISSION:JSON.stringify({clock})},
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(output,'utf8'), `minutes=${expected}\n`);
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
  }
});
