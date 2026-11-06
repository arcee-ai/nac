import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { inspectChecks } from './manual-stack-checks.mjs';

const sha = n => n.repeat(40);
const hash = s => createHash('sha256').update(s).digest('hex');
const digest = v => hash(JSON.stringify(v));
const workflow = '.github/workflows/stable-release.yml';
const unit = '.github/workflows/ci-admission.yml';
const full = 'ci-admission / NAC full admission v2 ';
const pure = 'ci-admission / NAC metadata observation v2 ';
const mandatory = ['Required PR checks', 'source-security / Full locked source scan',
  'macos-native / ARM macOS process and credentials'];

function fixture() {
  const repo = { id: 1194218201, full_name: 'arcee-ai/nac' };
  const pr = { number: 497, body: '', head: { ref: 'codex/native', sha: sha('a'), repo },
    base: { ref: 'dev', sha: sha('b'), repo } };
  const authority = ['ci-admission.py', 'ci-admission-bootstrap.py', 'ci-admission-applicability.json',
    'ci-admission-contract.json', 'cold-caches.py', 'pr-checks.mjs', 'publication-policy.mjs']
    .map(p => `.github/scripts/${p}`);
  const bytes = new Map([...authority, workflow, unit].map(p => [p, Buffer.from(p)]));
  bytes.set(authority[2], Buffer.from(JSON.stringify({ schema_version: 1, pr_checks_sha256: hash(bytes.get(authority[5])),
    prefixes: ['.github/', 'crates/', 'docker/managed/', 'scripts/'],
    exact_paths: ['Cargo.toml', 'Cargo.lock', 'Makefile', '.dockerignore', 'version.txt'] })));
  const blobs = new Map();
  const entries = [...bytes].map(([path, raw]) => {
    const id = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
    blobs.set(id, { sha: id, size: raw.length, encoding: 'base64', content: raw.toString('base64') });
    return { path, sha: id, mode: '100644', type: 'blob' };
  });
  const trees = {
    [sha('1')]: { sha: sha('1'), truncated: false, tree: structuredClone(entries) },
    [sha('2')]: { sha: sha('2'), truncated: false, tree: [...structuredClone(entries),
      { path: 'crates/new.rs', sha: sha('d'), mode: '100644', type: 'blob' }] },
  };
  const commits = {
    [sha('b')]: { sha: sha('b'), tree: { sha: sha('1') }, parents: [] },
    [sha('a')]: { sha: sha('a'), tree: { sha: sha('2') }, parents: [{ sha: sha('b') }] },
    [sha('c')]: { sha: sha('c'), tree: { sha: sha('2') }, parents: [{ sha: sha('b') }, { sha: sha('a') }] },
  };
  const hashes = [...bytes].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([p, raw]) => [p, hash(raw)]);
  // ASCII fixture paths have the same ordering as Python's sorted().
  hashes.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const tuple = digest([2, repo.id, repo.full_name, 497, repo.id, pr.head.sha, repo.id, 'dev', pr.base.sha,
    sha('c'), sha('2'), pr.base.sha, workflow, sha('c'), digest(hashes), false, true]);
  const makeRun = n => ({ id: n, run_number: n, run_attempt: 1, workflow_id: 100,
    path: workflow, check_suite_id: n * 100, repository: repo, head_repository: repo,
    head_sha: pr.head.sha, head_branch: pr.head.ref, event: 'pull_request',
    pull_requests: [{ number: 497, head: pr.head, base: pr.base }],
    status: 'completed', conclusion: 'success', referenced_workflows: [
      { path: `arcee-ai/nac/${unit}@${sha('c')}`, sha: sha('c'), ref: 'refs/pull/497/merge' }] });
  const f = { pr, trees, blobs, commits, runs: [makeRun(3), makeRun(2)], jobs: new Map(), checks: [],
    reads: new Map(), currentMerge: sha('c'), tuple };
  f.addJobs = (run, names) => {
    const jobs = names.map((name, i) => ({ id: run.id * 1000 + i + 1, run_id: run.id, run_attempt: 1,
      head_sha: pr.head.sha, name, started_at: '2026-11-06T20:00:00Z', status: 'completed', conclusion: 'success',
      check_run_url: `https://api.github.com/repos/arcee-ai/nac/check-runs/${run.id * 1000 + i + 1}` }));
    f.jobs.set(run.id, jobs);
    f.checks.push(...jobs.map(j => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
      head_sha: pr.head.sha, check_suite: { id: run.check_suite_id }, app: { id: 15368, slug: 'github-actions' } })));
    return jobs;
  };
  f.addJobs(f.runs[0], [pure + digest([2, tuple, 2, 1]), 'NAC metadata checks omitted']);
  f.addJobs(f.runs[1], [full + tuple, ...mandatory]);
  f.get = async path => {
    f.reads.set(path, (f.reads.get(path) ?? 0) + 1);
    f.onRead?.(path, f.reads.get(path));
    let value;
    if (path === 'actions/workflows/stable-release.yml') value = { id: 100, path: workflow, state: 'active' };
    else if (/^actions\/runs\/\d+$/.test(path)) value = f.runs.find(r => r.id === Number(path.split('/').at(-1)));
    else if (path.startsWith('git/commits/')) value = commits[path.split('/').at(-1)];
    else if (path.startsWith('git/trees/')) value = trees[path.split('/').at(-1).split('?')[0]];
    else if (path.startsWith('git/blobs/')) value = blobs.get(path.split('/').at(-1));
    else if (path === 'git/ref/pull/497/merge') value = { ref: 'refs/pull/497/merge', object: { type: 'commit', sha: f.currentMerge } };
    else if (path === 'pulls/497') value = f.currentPR ?? pr;
    else throw new Error(`Unexpected GET ${path}`);
    assert.ok(value, `Missing fixture ${path}`);
    return structuredClone(value);
  };
  f.pages = async (path, key) => {
    f.onPage?.(path, key);
    if (key === 'check_runs') return structuredClone(f.checks);
    if (key === 'statuses') return [];
    if (key === 'workflow_runs') return structuredClone(f.runs);
    if (key === 'jobs') return structuredClone(f.jobs.get(Number(path.split('/')[2])) ?? []);
    throw new Error(`Unexpected page ${path}`);
  };
  f.inspect = () => inspectChecks(pr, [], f);
  f.rename = (run, index, name) => {
    const job = f.jobs.get(run.id)[index]; job.name = name;
    f.checks.find(c => c.id === job.id).name = name;
  };
  f.makeRun = makeRun;
  return f;
}

test('proven metadata observations retain the latest FULL as the sole quality owner', async () => {
  const f = fixture();
  const second = f.makeRun(4); f.runs.unshift(second);
  f.addJobs(second, [pure + digest([2, f.tuple, 2, 1])]);
  const result = await f.inspect();
  assert.deepEqual(result.blockers, []);
  assert.equal(result.checkProvenance.selected.run, 2);
  assert.deepEqual(result.checkProvenance.observations.map(o => o.run), [4, 3]);
  assert.ok(result.records.every(r => r.disposition === 'current'));
  assert.deepEqual(result.checkProvenance.superseded, []);
});

test('newest FULL remains a veto even when metadata points at an older green', async t => {
  for (const [status, conclusion] of [['queued', null], ['in_progress', null], ['completed', 'failure'], ['completed', 'cancelled']]) {
    await t.test(`${status}/${conclusion}`, async () => {
      const f = fixture();
      const newer = f.makeRun(4), latest = f.makeRun(5); newer.status = status; newer.conclusion = conclusion;
      f.runs.unshift(latest, newer);
      f.addJobs(newer, [full + f.tuple, ...mandatory]);
      f.addJobs(latest, [pure + digest([2, f.tuple, 2, 1])]);
      assert.match((await f.inspect()).blockers.join(), /metadata pointer is not the newest FULL/);
      f.rename(latest, 0, pure + digest([2, f.tuple, 4, 1]));
      assert.match((await f.inspect()).blockers.join(), /Latest Stable run 4/);
    });
  }
});

test('unknown, changed, malformed or unbound observations hold without supersession', async t => {
  const mutations = {
    wrongPointer: f => f.rename(f.runs[0], 0, pure + '0'.repeat(64)),
    wrongTuple: f => f.rename(f.runs[1], 0, full + '0'.repeat(64)),
    coldTransition: f => { f.pr.body = '<!-- nac-ci-cold-caches -->'; },
    missingUnit: f => { f.runs[0].referenced_workflows = []; },
    duplicateUnit: f => { f.runs[0].referenced_workflows.push(f.runs[0].referenced_workflows[0]); },
    wrongRef: f => { f.runs[0].referenced_workflows[0].ref = 'refs/heads/dev'; },
    wrongPrepared: f => { f.runs[0].referenced_workflows[0].sha = sha('e'); },
    wrongHeadParent: f => { f.commits[sha('c')].parents[1].sha = sha('e'); },
    treeAliasBase: f => { f.commits[sha('c')].parents[0].sha = sha('e'); },
    truncatedTree: f => { f.trees[sha('1')].truncated = true; },
    changedAuthority: f => { f.trees[sha('2')].tree[0].sha = sha('e'); },
    addedWorkflow: f => { f.trees[sha('2')].tree.push({ path: '.github/workflows/extra.yml', sha: sha('e'), type: 'blob', mode: '100644' }); },
    badBlob: f => { f.blobs.values().next().value.content = 'd3Jvbmc='; },
    wrongApp: f => { f.checks[0].app.id = 7; },
    wrongSuite: f => { f.checks[0].check_suite.id = 123; },
    wrongJobHead: f => { f.jobs.get(3)[0].head_sha = sha('e'); },
    wrongJobRun: f => { f.jobs.get(3)[0].run_id = 2; },
    wrongAttempt: f => { f.runs[0].run_attempt = 2; },
    wrongJobAttempt: f => { f.jobs.get(3)[0].run_attempt = 2; },
    pendingMetadata: f => { f.runs[0].status = 'queued'; f.runs[0].conclusion = null; },
    unknownIntervening: f => { const r = f.makeRun(4); f.runs[0].run_number = 5; f.runs.push(r); f.addJobs(r, ['Unknown admission']); },
    duplicateRunNumber: f => { f.runs[1].run_number = 3; },
    protectedSkipped: f => { f.rename(f.runs[0], 1, mandatory[0]); f.jobs.get(3)[1].conclusion = 'skipped'; f.checks[1].conclusion = 'skipped'; },
    unboundProtectedCheck: f => { f.checks.push({ ...structuredClone(f.checks[0]), id: 999, name: mandatory[1], conclusion: 'skipped' }); },
    currentColdMutation: f => { f.currentPR = structuredClone(f.pr); f.currentPR.body = '<!-- nac-ci-cold-caches -->'; },
    detailMutation: f => { f.onRead = (p, count) => { if (p === 'actions/runs/3' && count === 2) f.runs[0].run_attempt++; }; },
    inventoryMutation: f => { let n = 0; f.onPage = (_, key) => { if (key === 'workflow_runs' && ++n === 2) f.runs.push(f.makeRun(6)); }; },
  };
  for (const [name, change] of Object.entries(mutations)) await t.test(name, async () => {
    const f = fixture(); change(f);
    const result = await f.inspect();
    assert.ok(result.blockers.length > 0, name);
    assert.deepEqual(result.checkProvenance.superseded, []);
    assert.ok(result.records.every(r => r.disposition === 'current'));
  });
});

test('other workflow failure or pending run remains a veto after metadata proof', async t => {
  for (const [status, conclusion] of [['queued', null], ['completed', 'failure']]) await t.test(status, async () => {
    const f = fixture(), other = f.makeRun(8);
    Object.assign(other, { workflow_id: 200, path: '.github/workflows/other.yml', status, conclusion });
    f.runs.push(other);
    const result = await f.inspect();
    assert.equal(result.checkProvenance.selected.run, 2);
    assert.match(result.blockers.join(), /Workflow 8 attempt 1/);
  });
});
