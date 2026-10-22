import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolvePublicationPolicy } from '../../.github/scripts/publication-policy.mjs';
import { INPUTS, POLICY, CONFIG } from '../../.github/scripts/source-security.mjs';
import { evaluateImage, loadImagePublicationPolicy, selectImagePolicyInputs } from './image-policy.mjs';

const empty = { schema_version: 1, exceptions: [] };
const finding = { advisory: 'TEST-IMAGE-PUBLICATION', package: 'binary:node', version: '24.22.1',
  context: 'managed-image', severity: 'High' };
const entry = { advisory: finding.advisory, package: finding.package, context: finding.context,
  reason: 'Synthetic test only; no production exception approval', owner: '@fixture-owner',
  linked_issue: 'https://example.invalid/issues/fixture',
  expires: new Date(Date.now() + 7 * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z') };
const granted = value => ({ schema_version: 1, exceptions: [value] });
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function fixture(t, { candidate = empty, reviewed = granted(entry) } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nac-image-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidateRoot = join(root, 'candidate');
  const trustedRoot = join(root, 'reviewed-dev');
  mkdirSync(candidateRoot);
  git(candidateRoot, 'init', '--quiet');
  git(candidateRoot, 'config', 'user.name', 'Fixture');
  git(candidateRoot, 'config', 'user.email', 'fixture@example.invalid');
  git(candidateRoot, 'config', 'commit.gpgSign', 'false');
  git(candidateRoot, 'config', 'tag.gpgSign', 'false');
  git(candidateRoot, 'config', 'tag.forceSignAnnotated', 'false');
  git(candidateRoot, 'remote', 'add', 'origin', 'https://github.com/example/fixture.git');
  for (const input of INPUTS) {
    mkdirSync(join(candidateRoot, dirname(input)), { recursive: true });
    const source = input === INPUTS[0] ? 'Cargo.lock' : 'package-lock.json';
    copyFileSync(fileURLToPath(new URL(`../../.github/scripts/fixtures/security/safe/${source}`,
      import.meta.url)), join(candidateRoot, input));
  }
  mkdirSync(join(candidateRoot, dirname(POLICY)), { recursive: true });
  writeFileSync(join(candidateRoot, CONFIG), '# No scanner overrides\n');
  writeFileSync(join(candidateRoot, POLICY), JSON.stringify(candidate));
  git(candidateRoot, 'add', '.');
  git(candidateRoot, 'commit', '--quiet', '-m', 'immutable candidate');
  const candidateSha = git(candidateRoot, 'rev-parse', 'HEAD');
  git(candidateRoot, 'tag', 'v0.1.5');
  writeFileSync(join(candidateRoot, POLICY), JSON.stringify(reviewed));
  git(candidateRoot, 'add', '.');
  git(candidateRoot, 'commit', '--quiet', '--allow-empty', '-m', 'reviewed dev policy');
  const policySha = git(candidateRoot, 'rev-parse', 'HEAD');
  git(candidateRoot, 'worktree', 'add', '--detach', trustedRoot, policySha);
  git(candidateRoot, 'checkout', '--detach', candidateSha);
  const eventPath = join(root, 'event.json');
  const event = { ref: 'refs/tags/v0.1.5', deleted: false,
    repository: { full_name: 'example/fixture' } };
  writeFileSync(eventPath, JSON.stringify(event));
  const environment = { ...process.env, GITHUB_REPOSITORY: 'example/fixture',
    GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push', GITHUB_REF: event.ref,
    GITHUB_SHA: candidateSha, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2',
    NAC_PUBLICATION_POLICY_SHA: policySha };
  const readRef = endpoint => {
    assert.equal(endpoint, 'repos/example/fixture/git/ref/heads/dev');
    return { ref: 'refs/heads/dev',
      url: 'https://api.github.com/repos/example/fixture/git/refs/heads/dev',
      object: { type: 'commit', sha: policySha,
        url: `https://api.github.com/repos/example/fixture/git/commits/${policySha}` } };
  };
  const receipt = resolvePublicationPolicy({ candidateSha, environment, readRef });
  return { root, candidateRoot, trustedRoot, candidateSha, policySha, environment, readRef, receipt,
    policyFile: join(trustedRoot, POLICY), candidatePolicyFile: join(candidateRoot, POLICY) };
}

const load = (f, overrides = {}, options = {}) => loadImagePublicationPolicy({ ...f, ...overrides },
  { environment: f.environment, ...options });

test('a later separately reviewed image grant recovers the same immutable candidate', t => {
  const f = fixture(t);
  const result = evaluateImage([finding], load(f));
  assert.equal(result.excepted.length, 1);
  assert.equal(result.blocking.length, 0);
  assert.equal(git(f.candidateRoot, 'rev-parse', 'HEAD'), f.candidateSha);
  assert.equal(JSON.parse(readFileSync(f.candidatePolicyFile)).exceptions.length, 0);
});

test('revoked and expired historical tag grants cannot survive the effective reviewed policy', t => {
  for (const candidate of [granted(entry), granted({ ...entry, expires: '2020-01-01T00:00:00Z' })]) {
    const f = fixture(t, { candidate, reviewed: empty });
    const result = evaluateImage([finding], load(f));
    assert.equal(result.excepted.length, 0);
    assert.equal(result.blocking.length, 1);
  }
});

test('source-context grants cannot clear image findings through publication mode', t => {
  const f = fixture(t, { reviewed: granted({ ...entry, context: 'Cargo.lock' }) });
  assert.equal(evaluateImage([finding], load(f)).blocking.length, 1);
});

test('ordinary PR, manual and protected branch events cannot opt into publication grants', t => {
  const f = fixture(t);
  const eventPath = f.environment.GITHUB_EVENT_PATH;
  for (const [name, ref] of [['pull_request', 'refs/pull/1/merge'],
    ['workflow_dispatch', 'refs/heads/topic'], ['push', 'refs/heads/dev'], ['push', 'refs/heads/main']]) {
    const event = { ref, repository: { full_name: 'example/fixture' },
      pull_request: { base: { sha: f.policySha } } };
    writeFileSync(eventPath, JSON.stringify(event));
    const environment = { ...f.environment, GITHUB_EVENT_NAME: name, GITHUB_REF: ref };
    assert.throws(() => load(f, {}, { environment }), /publication/);
    assert.throws(() => selectImagePolicyInputs(f.candidateSha, {
      environment, readRef: f.readRef, requestedMode: 'publication',
    }), /policy mode/);
    const selected = selectImagePolicyInputs(f.candidateSha, { environment, readRef: f.readRef });
    assert.equal(selected.mode, 'ordinary');
    if (name === 'workflow_dispatch' || ref === 'refs/heads/main' || name === 'pull_request') {
      assert.equal(selected.policy_sha, f.policySha);
    } else assert.equal(selected.policy_sha, f.candidateSha);
  }
});

test('caller-selected publication revisions and mismatched ordinary pins are rejected', t => {
  const f = fixture(t);
  assert.deepEqual(selectImagePolicyInputs(f.candidateSha, { environment: f.environment,
    requestedMode: 'publication' }), { mode: 'publication', policy_sha: '' });
  assert.throws(() => selectImagePolicyInputs(f.candidateSha, { environment: f.environment,
    requestedMode: 'publication', requestedSha: f.policySha }), /cannot select/);
  assert.throws(() => selectImagePolicyInputs(f.candidateSha, { environment: f.environment,
    requestedMode: 'ordinary' }), /policy mode/);
  writeFileSync(f.environment.GITHUB_EVENT_PATH, JSON.stringify({ repository: { full_name: 'example/fixture' },
    pull_request: { base: { sha: f.policySha } } }));
  const environment = { ...f.environment, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' };
  assert.throws(() => selectImagePolicyInputs(f.candidateSha, { environment,
    requestedSha: f.candidateSha }), /cannot select/);
  const manual = { ...environment, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/topic' };
  assert.throws(() => selectImagePolicyInputs(f.candidateSha, { environment: manual,
    readRef: () => { throw new Error('canonical policy unavailable'); } }), /unavailable/);
  assert.throws(() => selectImagePolicyInputs(f.candidateSha, { environment: manual,
    readRef: () => ({}) }), /canonical reviewed-dev/);
});

test('missing, spoofed and differently bound receipts never fall back to tag policy', t => {
  const f = fixture(t, { candidate: granted(entry) });
  for (const receipt of [undefined, {}, { ...f.receipt, sha: 'a'.repeat(40) },
    { ...f.receipt, run_id: '999' }, { ...f.receipt, candidate_sha: 'b'.repeat(40) },
    { ...f.receipt, repository: 'other/repository' }]) {
    assert.throws(() => load(f, { receipt }));
  }
  assert.throws(() => load(f, { candidateSha: 'c'.repeat(40) }), /scanned image source/);
  assert.throws(() => load(f, { receipt: undefined, candidateSha: undefined }), /scanned image source/);
  assert.throws(() => load(f, { policyFile: f.candidatePolicyFile }), /pinned checkouts/);
  assert.throws(() => load(f, {}, { environment: { ...f.environment, NAC_PUBLICATION_POLICY_SHA: '' } }), /pinned/);
});

test('missing or altered trusted files and moved tag identity fail closed', t => {
  const f = fixture(t, { candidate: granted(entry) });
  writeFileSync(f.policyFile, JSON.stringify(empty));
  assert.throws(() => load(f));
  rmSync(f.policyFile);
  assert.throws(() => load(f));
  git(f.trustedRoot, 'checkout', '--', POLICY);
  git(f.trustedRoot, 'tag', '--force', 'v0.1.5', f.policySha);
  assert.throws(() => load(f), /immutable event tag/);
});

test('malformed and expired effective reviewed grants cannot reuse valid tag grants', t => {
  for (const reviewed of [granted({ ...entry, owner: '' }),
    granted({ ...entry, expires: '2020-01-01T00:00:00Z' }), { schema_version: 2, exceptions: [] }]) {
    const f = fixture(t, { candidate: granted(entry), reviewed });
    assert.throws(() => load(f));
  }
});

test('Python-to-Node publication evaluation preserves PR denial, recovery and revocation', t => {
  const scripts = dirname(fileURLToPath(import.meta.url));
  const program = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport image_scan as scan\nout=Path(sys.argv[7]);out.mkdir()\nr=scan.evaluate(json.loads(sys.argv[8]),Path(sys.argv[2]),Path(sys.argv[3]),out,publication_policy=Path(sys.argv[4]) if sys.argv[4] else None,source_revision=sys.argv[5],candidate_root=Path(sys.argv[6]))\nprint(json.dumps({'blocking':len(r['blocking']),'excepted':len(r['excepted']),'source':r.get('policy_source')}))`;
  for (const [label, candidate, reviewed, expected] of [
    ['recovery', empty, granted(entry), 0], ['revocation', granted(entry), empty, 1],
  ]) {
    const f = fixture(t, { candidate, reviewed });
    const receiptFile = join(f.root, 'receipt.json');
    writeFileSync(receiptFile, JSON.stringify(f.receipt));
    const args = [scripts, f.policyFile, f.candidatePolicyFile, receiptFile,
      f.candidateSha, f.candidateRoot, join(f.root, 'evaluated'), JSON.stringify([finding])];
    const run = values => spawnSync('python3', ['-c', program, ...values], {
      env: f.environment, encoding: 'utf8', cwd: resolve(scripts, '../..'),
    });
    const publication = run(args);
    assert.equal(publication.status, 0, publication.stderr);
    const result = JSON.parse(publication.stdout);
    assert.equal(result.blocking, expected, label);
    assert.equal(result.source.sha, f.policySha);
    const metadata = JSON.parse(readFileSync(join(f.root, 'evaluated/policy-input.json')));
    const retained = readFileSync(join(f.root, 'evaluated/publication-policy.json'));
    assert.equal(metadata.publication_receipt_sha256, createHash('sha256').update(retained).digest('hex'));
    const ordinary = run(args.map((v, i) => i === 3 ? '' : i === 6 ? join(f.root, 'ordinary') : v));
    assert.notEqual(ordinary.status, 0);
    assert.match(ordinary.stderr, /candidate changes exception policy/);
  }
});
