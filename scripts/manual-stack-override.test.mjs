import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { authoredDelta, createHelper, ghTransport, main } from './manual-stack-override.mjs';

const sha = letter => letter.repeat(40);
const root = 'repos/arcee-ai/nac';
const uuid = '630b9d5e-3f2a-4f7e-8b0c-2d5f9a8c1e42';
const clone = value => structuredClone(value);
const file = { filename: 'file.txt', sha: sha('9'), additions: 1, deletions: 1 };
function diff(offset = 1, text = 'new', blob = '2222222') {
  return `diff --git a/file.txt b/file.txt\nindex 1111111..${blob} 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -${offset} +${offset} @@\n-old\n+${text}\n`;
}

function fixture() {
  const repo = { full_name: 'arcee-ai/nac' };
  const make = (number, head, base, baseRef) => ({ number, title: `Layer ${number}`, state: 'open',
    merged: false, merged_at: null, merge_commit_sha: sha(number === 11 ? '9' : '8'),
    draft: false, mergeable: true, mergeable_state: 'blocked', changed_files: 1,
    head: { ref: `codex/${number}`, sha: sha(head), repo }, base: { ref: baseRef, sha: sha(base), repo } });
  const f = { prs: [make(11, 'a', 'b', 'dev'), make(12, 'c', 'a', 'codex/11')],
    viewer: { login: 'allisoneer', id: 20910163, type: 'User' }, calls: [],
    responseStatus: 202, results: ['pending', 'merged'], text: 'new', offset: 1,
    checks: ['Required PR checks', 'source-security / Full locked source scan',
      'macos-native / ARM macOS process and credentials'].map(name =>
      ({ name, status: 'completed', conclusion: 'success' })), unresolved: false, time: 0,
    historicalChecks: [], statuses: [], currentRun: {}, historicalRun: {},
    extraChecks: () => [], extraRuns: () => [], oldJobs: {},
    review: {
      "enforcement": "active",
      "current_user_can_bypass": "pull_requests_only",
      "bypass_actors": [
        {
          "actor_id": 20910163,
          "actor_type": "User",
          "bypass_mode": "pull_request"
        }
      ],
      "conditions": {
        "ref_name": {
          "exclude": [],
          "include": [
            "~DEFAULT_BRANCH"
          ]
        }
      },
      "rules": [
        {
          "type": "pull_request",
          "parameters": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews_on_push": false,
            "required_reviewers": [],
            "require_code_owner_review": true,
            "dismissal_restriction": {
              "enabled": false,
              "allowed_actors": []
            },
            "require_last_push_approval": true,
            "required_review_thread_resolution": true,
            "require_extra_approval_for_unattributed_changes": true,
            "allowed_merge_methods": [
              "merge",
              "squash",
              "rebase"
            ]
          }
        },
        {
          "type": "required_status_checks",
          "parameters": {
            "strict_required_status_checks_policy": true,
            "do_not_enforce_on_create": false,
            "required_status_checks": [
              {
                "context": "Required PR checks",
                "integration_id": 15368
              }
            ]
          }
        }
      ]
    },
    universal: {
      "enforcement": "active",
      "current_user_can_bypass": "never",
      "bypass_actors": [],
      "conditions": {
        "ref_name": {
          "exclude": [],
          "include": [
            "~DEFAULT_BRANCH"
          ]
        }
      },
      "rules": [
        {
          "type": "deletion"
        },
        {
          "type": "non_fast_forward"
        },
        {
          "type": "pull_request",
          "parameters": {
            "required_approving_review_count": 0,
            "dismiss_stale_reviews_on_push": false,
            "required_reviewers": [],
            "require_code_owner_review": false,
            "dismissal_restriction": {
              "enabled": false,
              "allowed_actors": []
            },
            "require_last_push_approval": false,
            "required_review_thread_resolution": false,
            "require_extra_approval_for_unattributed_changes": false,
            "allowed_merge_methods": [
              "merge",
              "squash",
              "rebase"
            ]
          }
        }
      ]
    },
    rules: [],
  };
  f.rules = [
    { ruleset_id: 2955537, type: 'deletion' },
    { ruleset_id: 2955537, type: 'non_fast_forward' },
    { ruleset_id: 2955527, type: 'repository_transfer' },
    ...f.review.rules.map(rule => ({ ruleset_id: 26484091, ...clone(rule) })),
    ...f.universal.rules.map(rule => ({ ruleset_id: 25983949, ...clone(rule) })),
  ];
  f.open = () => f.prs.filter(pr => !pr.merged);
  f.stack = () => ({ number: 99, open: true, base: { ref: 'dev' }, pull_requests: clone(f.prs) });
  f.pr = number => {
    const pr = clone(f.prs.find(p => p.number === number));
    if (f.omitLegacyMergeSha) delete pr.merge_commit_sha;
    pr.stack = { number: 99, size: f.prs.length, position: f.prs.findIndex(p => p.number === number) + 1 };
    return pr;
  };
  f.run = (pr, sequence = 2) => ({
    id: pr.number * 1000 + sequence, run_number: sequence, run_attempt: 1,
    workflow_id: 100, path: '.github/workflows/stable-release.yml',
    check_suite_id: pr.number * 100 + sequence,
    repository: repo, head_repository: repo, event: 'pull_request',
    head_sha: pr.head.sha, head_branch: pr.head.ref,
    pull_requests: [{ number: pr.number, head: pr.head, base: pr.base }],
    status: 'completed', conclusion: 'success',
    referenced_workflows: [{ path: `arcee-ai/nac/.github/workflows/macos-native.yml@${sha(pr.number === 11 ? '9' : '8')}`,
      sha: sha(pr.number === 11 ? '9' : '8'), ref: `refs/pull/${pr.number}/merge` }],
    ...(sequence === 2 ? f.currentRun : f.historicalRun),
  });
  f.checkRows = (pr, sequence = 2) => (sequence === 2 ? f.checks : f.historicalChecks).map((c, i) => ({
    id: (pr.number * 1000 + sequence) * 100 + i, head_sha: pr.head.sha,
    check_suite: { id: pr.number * 100 + sequence }, app: { id: 15368, slug: 'github-actions' },
    ...c,
  }));
  f.land = number => {
    const pr = f.prs.find(p => p.number === number);
    pr.merged = true;
    pr.state = 'closed';
    pr.merged_at = '2026-11-03T21:00:00Z';
    pr.merge_commit_sha = sha(number === 11 ? 'd' : 'f');
    const next = f.open()[0];
    if (next) {
      next.base = { ...next.base, ref: 'dev', sha: pr.merge_commit_sha };
      next.head.sha = sha('e');
      f.offset = 17;
      f.afterLanding?.(f);
    }
    return { status: 'merged', details: { sha: pr.merge_commit_sha, ...f.landedDetailsOverrides } };
  };
  f.transport = async (method, endpoint, body, accept) => {
    f.calls.push({ method, endpoint, body: clone(body), accept });
    const ok = body => ({ status: 200, body: clone(body) });
    const page = rows => rows.slice((Number(new URLSearchParams(endpoint.split('?')[1]).get('page') ?? 1) - 1) * 100,
      Number(new URLSearchParams(endpoint.split('?')[1]).get('page') ?? 1) * 100);
    if (endpoint === 'user') return ok(f.viewer);
    if (endpoint.endsWith('/rulesets/26484091')) return ok(f.review);
    if (endpoint.endsWith('/rulesets/25983949')) return ok(f.universal);
    if (endpoint.endsWith('/rules/branches/dev')) return ok(f.rules);
    if (endpoint.endsWith('/stacks/99')) return ok(f.stack());
    if (endpoint === 'graphql') {
      assert.match(body.query, /^query/);
      if (body.query.includes('mergeCommit')) {
        if (f.receiptError || f.receiptErrorNumber === body.variables.number) {
          return { status: 503, body: { message: 'Receipt service unavailable' } };
        }
        const pr = f.prs.find(p => p.number === body.variables.number);
        return ok({ data: { repository: f.receiptNullRepository ? null : { nameWithOwner: f.receiptRepo ?? 'arcee-ai/nac',
          pullRequest: { number: pr.number, merged: pr.merged, headRefOid: pr.head.sha,
            baseRefName: pr.base.ref, mergeCommit: { oid: pr.merge_commit_sha }, ...f.receiptOverrides } } },
        ...(f.receiptQueryErrors ? { errors: [{ message: 'Receipt query failed' }] } : {}) });
      }
      const pr = f.pr(body.variables.number);
      const data = { data: { repository: { pullRequest: { headRefOid: pr.head.sha,
        reviewThreads: { nodes: [{ isResolved: !f.unresolved }], pageInfo: { hasNextPage: false } } } } } };
      f.onReviewRead?.(f);
      return ok(data);
    }
    if (endpoint.includes('/check-runs?')) {
      const pr = f.prs.find(p => endpoint.includes(p.head.sha));
      f.onChecksRead?.(f, pr);
      return ok({ check_runs: page([...f.checkRows(pr), ...f.checkRows(pr, 1), ...f.extraChecks(pr)]) });
    }
    if (endpoint.includes('/status?')) { f.onStatusesRead?.(f); return ok({ statuses: f.statuses }); }
    if (endpoint.includes('/actions/workflows/')) return ok({ id: 100, path: '.github/workflows/stable-release.yml', state: 'active', ...f.workflowOverrides });
    if (endpoint.includes('/actions/runs?')) {
      const pr = f.prs.find(p => endpoint.includes(p.head.sha));
      f.onRunsRead?.(f, pr);
      return ok({ workflow_runs: page([f.run(pr), f.run(pr, 1), ...f.extraRuns(pr)]) });
    }
    const runMatch = endpoint.match(/\/actions\/runs\/(\d+)(.*)$/);
    if (runMatch) {
      const pr = f.prs.find(p => Math.floor(Number(runMatch[1]) / 1000) === p.number);
      if (!runMatch[2]) { f.onRunRead?.(f); return ok(f.run(pr)); }
      return ok({ jobs: page(f.checkRows(pr).map(c => ({ id: c.id, name: c.name,
        head_sha: pr.head.sha, run_id: f.run(pr).id, run_attempt: 1,
        check_run_url: `https://api.github.com/${root}/check-runs/${c.id}`,
        status: c.status, conclusion: c.conclusion,
        ...(typeof f.jobOverrides === 'function' ? f.jobOverrides(c) : f.jobOverrides) }))) });
    }
    if (endpoint.includes('/actions/jobs/')) {
      const id = Number(endpoint.split('/').at(-1));
      assert.ok(f.oldJobs[id], 'Unknown old job fixture');
      return ok(f.oldJobs[id]);
    }
    const mergeRef = endpoint.match(/\/git\/ref\/pull\/(\d+)\/merge$/);
    if (mergeRef) {
      const pr = f.prs.find(p => p.number === Number(mergeRef[1]));
      return ok({ ref: `refs/pull/${pr.number}/merge`, object: {
        type: 'commit', sha: pr.merge_commit_sha ?? sha(pr.number === 11 ? '9' : '8') }, ...f.mergeRefOverrides });
    }
    if (endpoint.includes('/git/commits/')) {
      const id = endpoint.split('/').at(-1);
      const tree = s => f.trees?.[s] ?? sha(({ a: '1', b: '3', c: '2', d: '4', e: '5' })[s[0]] ?? '0');
      if (id === f.unavailableCommit) throw new Error('Git commit API unavailable');
      const pr = f.prs.find(p => id === sha(p.number === 11 ? '9' : '8'));
      if (pr) return ok({ sha: id, tree: { sha: tree(pr.head.sha) }, parents: [
        { sha: f.syntheticBase && pr.number === 12 ? sha('6') : pr.base.sha },
        { sha: pr.head.sha }], ...f.commitOverrides });
      const prepared = f.prs.find(p => f.syntheticBase && p.number === 12 && id === sha('6'));
      if (prepared) return ok({ sha: id, tree: { sha: f.preparedBaseTree ?? tree(prepared.base.sha) }, parents: [] });
      return ok({ sha: id, tree: { sha: id === f.prs[0].base.sha ? f.baseTree ?? tree(id) : tree(id) }, parents: [] });
    }
    if (endpoint.includes('/compare/')) {
      if (accept === 'application/vnd.github.diff') return ok(diff(f.offset, f.text));
      const base = endpoint.split('/compare/')[1].split('...')[0];
      return ok({ base_commit: { sha: base }, merge_base_commit: { sha: base }, status: 'ahead',
        files: [{ ...file, sha: f.fileSha ?? file.sha }] });
    }
    const match = endpoint.match(/\/pulls\/(\d+)(.*)$/);
    if (match) {
      const number = Number(match[1]);
      if (!match[2]) return ok(f.pr(number));
      if (method === 'PUT') {
        assert.equal(match[2], '/merge-async');
        f.beforeRequest?.(f, body);
        if (f.responseStatus === 200) return ok(f.land(number));
        if (f.responseStatus === 403) return { status: 403, body: { message: 'Forbidden' } };
        f.options = { uuid, merge_method: body.merge_method, merge_action: body.merge_action,
          expected_head_sha: body.sha, bypass_rules: body.bypass_rules, ...f.optionOverrides };
        return { status: f.responseStatus, body: { status: 'pending', details: f.options } };
      }
      assert.equal(match[2], `/merge-async/${uuid}`);
      const status = f.results.length > 1 ? f.results.shift() : f.results[0];
      return ok(status === 'merged' ? f.land(number) : { status, details: { message: status, ...f.options } });
    }
    throw new Error(`Unexpected request ${method} ${endpoint}`);
  };
  f.helper = createHelper(f.transport, { sleep: async ms => { f.time += ms; }, now: () => f.time,
    timeoutMs: 5000, log: () => {} });
  f.preview = () => f.helper.preview(99, [11, 12]);
  f.writes = () => f.calls.filter(call => call.method === 'PUT');
  return f;
}

test('preview saves exact ordered heads/base/check evidence and performs no merge mutation', async () => {
  const f = fixture();
  f.checks[0].conclusion = 'failure';
  const plan = await f.preview();
  assert.deepEqual(plan.members.map(m => m.number), [11, 12]);
  assert.equal(plan.members[0].head.sha, sha('a'));
  assert.equal(plan.members[0].base.sha, sha('b'));
  assert.equal(plan.members[0].draft, false);
  assert.equal(plan.members[0].mergeable, true);
  assert.match(plan.members[0].blockers.join(), /Required PR checks: failure/);
  assert.equal(f.writes().length, 0);
});

test('confirmed landed commits use provider receipts when pinned REST omits legacy SHA', async () => {
  for (const responseStatus of [200, 202, 409]) {
    const f = fixture(); f.omitLegacyMergeSha = true; f.responseStatus = responseStatus;
    const plan = await f.preview();
    assert.deepEqual(await f.helper.execute(plan), { landed: [11, 12], remaining: [] });
    assert.equal(f.writes().length, 2);
    const receipts = f.calls.filter(c => c.endpoint === 'graphql' && c.body.query.includes('mergeCommit'));
    assert.deepEqual(receipts.map(c => c.body.variables.number), [11, 12]);
    assert.equal(f.calls.filter(c => c.method === 'PUT').length, 2);
  }
});

test('uncertain landed receipts stop after one fake request and preserve its UUID/progress', async t => {
  const changes = {
    wrongCommit: f => { f.receiptOverrides = { mergeCommit: { oid: sha('7') } }; },
    syntheticInsteadOfLanded: f => { f.receiptOverrides = { mergeCommit: { oid: sha('9') } }; },
    nullCommit: f => { f.receiptOverrides = { mergeCommit: null }; },
    wrongHead: f => { f.receiptOverrides = { headRefOid: sha('f') }; },
    nullHead: f => { f.receiptOverrides = { headRefOid: null }; },
    wrongPR: f => { f.receiptOverrides = { number: 999 }; },
    wrongRepo: f => { f.receiptRepo = 'other/repository'; },
    nullRepo: f => { f.receiptNullRepository = true; },
    notMerged: f => { f.receiptOverrides = { merged: false }; },
    unknownMerged: f => { f.receiptOverrides = { merged: null }; },
    wrongBase: f => { f.receiptOverrides = { baseRefName: 'main' }; },
    queryError: f => { f.receiptQueryErrors = true; },
    transient503: f => { f.receiptError = true; },
    changedRESTHead: f => { f.afterLanding = current => { current.prs[0].head.sha = sha('f'); }; },
    contradictoryRESTState: f => { f.afterLanding = current => { current.prs[0].state = 'open'; }; },
    wrongRESTBase: f => { f.afterLanding = current => { current.prs[0].base.ref = 'main'; }; },
    nullRESTResult: f => { f.landedDetailsOverrides = { sha: null }; },
    wrongResult: f => { f.landedDetailsOverrides = { sha: sha('7') }; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture(); const plan = await f.preview(); change(f);
    await assert.rejects(f.helper.execute(plan), error => {
      assert.match(error.message, /not confirmed|503/);
      assert.match(error.message, /"landed":\[\],"remaining":\[11,12\]/);
      assert.match(error.message, new RegExp(`"active":\\{"number":11,"uuid":"${uuid}"\\}`));
      return true;
    });
    assert.equal(f.writes().length, 1);
    assert.equal(f.prs[0].merged, true, 'the simulated landing remains uncertain, never rolled back');
    assert.equal(f.prs[1].merged, false, 'no next-member request after uncertain receipt');
    assert.equal(f.calls.filter(c => c.endpoint === 'graphql' && c.body.query.includes('mergeCommit')).length,
      name.includes('REST') ? 0 : 1);
  });
});

test('receipt failure after a confirmed member retains exact partial progress without retry', async () => {
  const f = fixture(); f.omitLegacyMergeSha = true; f.receiptErrorNumber = 12;
  const plan = await f.preview();
  await assert.rejects(f.helper.execute(plan), error => {
    assert.match(error.message, /503/);
    assert.match(error.message, /"landed":\[11\],"remaining":\[12\]/);
    assert.match(error.message, new RegExp(`"active":\\{"number":12,"uuid":"${uuid}"\\}`));
    return true;
  });
  assert.deepEqual(f.writes().map(c => c.endpoint), [
    `${root}/pulls/11/merge-async`, `${root}/pulls/12/merge-async`,
  ]);
  assert.ok(f.prs.every(pr => pr.merged), 'the second simulated landing still requires reconciliation');
});

test('new applicable workflow supersedes historical failure while retaining its evidence', async () => {
  const f = fixture();
  f.historicalChecks = [{ name: 'test', status: 'completed', conclusion: 'failure', output: { summary: 'original failure' } }];
  const plan = await f.preview();
  assert.deepEqual(plan.members[0].blockers, []);
  const old = plan.members[0].records.find(r => r.state === 'failure');
  assert.equal(old.disposition, 'superseded');
  assert.equal(old.supersededBy.run, 11002);
  assert.equal(old.output.summary, 'original failure');
  assert.equal(f.writes().length, 0);
});

test('latest queued, pending, failure and cancellation never fall back to older green', async t => {
  for (const [status, conclusion] of [['queued', null], ['in_progress', null],
    ['completed', 'failure'], ['completed', 'cancelled']]) {
    await t.test(`${status}/${conclusion}`, async () => {
      const f = fixture();
      f.currentRun = { status, conclusion };
      f.historicalChecks = clone(f.checks);
      const plan = await f.preview();
      assert.match(plan.members[0].blockers.join(), /Latest Stable run/);
      await assert.rejects(f.helper.execute(plan), /not admissible/);
      assert.equal(f.writes().length, 0);
    });
  }
});

test('wrong provenance cannot supersede a failed historical check', async t => {
  const changes = {
    app: f => { f.checks = f.checks.map(c => ({ ...c, app: { id: 7, slug: 'other' } })); },
    repository: f => { f.currentRun.repository = { full_name: 'other/repo' }; },
    headRepository: f => { f.currentRun.head_repository = { full_name: 'other/repo' }; },
    workflow: f => { f.currentRun.workflow_id = 200; },
    workflowPath: f => { f.currentRun.path = '.github/workflows/other.yml'; },
    event: f => { f.currentRun.event = 'pull_request_target'; },
    head: f => { f.currentRun.head_sha = sha('f'); },
    branch: f => { f.currentRun.head_branch = 'other'; },
    checkHead: f => { f.checks[0].head_sha = sha('f'); },
    pr: f => { f.currentRun.pull_requests = [{ ...f.pr(11), number: 999 }]; },
    base: f => { const p = f.pr(11); p.base.sha = sha('f'); f.currentRun.pull_requests = [p]; },
    baseRef: f => { const p = f.pr(11); p.base.ref = 'other'; f.currentRun.pull_requests = [p]; },
    testedMerge: f => { f.commitOverrides = { parents: [{ sha: sha('f') }, { sha: sha('a') }] }; },
    missingMerge: f => { f.currentRun.referenced_workflows = []; },
    foreignMergeRef: f => { f.currentRun.referenced_workflows = [{ sha: sha('9'),
      path: `arcee-ai/nac/.github/workflows/macos-native.yml@${sha('9')}`, ref: 'refs/pull/999/merge' }]; },
    disabledWorkflow: f => { f.workflowOverrides = { state: 'disabled_manually' }; },
    jobHead: f => { f.jobOverrides = { head_sha: sha('f') }; },
    jobRun: f => { f.jobOverrides = { run_id: 999 }; },
    futureAttempt: f => { f.jobOverrides = { run_attempt: 2 }; },
    foreignJobUrl: f => { f.jobOverrides = { check_run_url: 'https://apiXgithubYcom/repos/arcee-ai/nac/check-runs/1100200' }; },
    ambiguousOldBase: f => { const p = f.pr(11); p.base.sha = sha('f'); f.historicalRun.pull_requests = [p]; },
  };
  for (const [label, change] of Object.entries(changes)) await t.test(label, async () => {
    const f = fixture();
    f.historicalChecks = [{ name: 'test', status: 'completed', conclusion: 'failure' }];
    change(f);
    const plan = await f.preview();
    assert.ok(plan.members[0].blockers.length, label);
    assert.equal(plan.members[0].records.find(r => r.state === 'failure').disposition, 'current');
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
});

test('other app/workflow failures and new pipelines remain independent vetoes', async t => {
  for (const app of [{ id: 7, slug: 'other' }, { id: 15368, slug: 'github-actions' }]) {
    await t.test(`independent app ${app.id}`, async () => {
      const f = fixture();
      f.extraChecks = pr => [{ id: 999, name: 'test', head_sha: pr.head.sha,
        app, check_suite: { id: 999 }, status: 'completed', conclusion: 'failure' }];
      const plan = await f.preview();
      assert.match(plan.members[0].blockers.join(), /test: failure/);
      assert.equal(plan.members[0].records.find(r => r.id === 999).disposition, 'current');
      await assert.rejects(f.helper.execute(plan));
      assert.equal(f.writes().length, 0);
    });
  }
  for (const [status, conclusion] of [['queued', null], ['in_progress', null],
    ['completed', 'failure'], ['completed', 'cancelled']]) await t.test(`other ${status}/${conclusion}`, async () => {
    const f = fixture();
    f.extraRuns = pr => [{ ...f.run(pr), id: 9000, workflow_id: 200,
      path: '.github/workflows/independent.yml', status, conclusion }];
    const plan = await f.preview();
    assert.match(plan.members[0].blockers.join(), /Workflow 9000 attempt 1/);
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
});

test('required checks and statuses both apply, with their expected integration', async t => {
  for (const status of ['pending', 'failure', 'error']) await t.test(`status ${status}`, async () => {
    const f = fixture();
    f.statuses = [{ id: 1, context: 'Required PR checks', state: status,
      performed_via_github_app: { id: 15368 } }];
    const plan = await f.preview();
    assert.match(plan.members[0].blockers.join(), new RegExp(`Required PR checks: ${status}`));
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
  const both = fixture();
  both.statuses = [{ id: 1, context: 'Required PR checks', state: 'success',
    performed_via_github_app: { id: 15368 } }];
  assert.deepEqual((await both.preview()).members[0].blockers, []);
  const unknown = fixture();
  unknown.statuses = [{ context: 'Required PR checks', state: 'success' }];
  assert.match((await unknown.preview()).members[0].blockers.join(), /expected app 15368 is unproven/);
  const failedCheck = fixture();
  failedCheck.checks[0].conclusion = 'failure';
  failedCheck.statuses = clone(both.statuses);
  assert.match((await failedCheck.preview()).members[0].blockers.join(), /Required PR checks: failure/);
  const external = fixture();
  external.rules.push({ type: 'required_status_checks', parameters: {
    required_status_checks: [{ context: 'external', integration_id: 200 }] } });
  external.extraChecks = pr => [{ id: 999, name: 'external', head_sha: pr.head.sha,
    app: { id: 200, slug: 'external' }, status: 'completed', conclusion: 'success' }];
  assert.deepEqual((await external.preview()).members[0].blockers, []);
  external.extraChecks = pr => [{ id: 999, name: 'external', head_sha: pr.head.sha,
    app: { id: 201, slug: 'wrong' }, status: 'completed', conclusion: 'success' }];
  assert.match((await external.preview()).members[0].blockers.join(), /expected app/);
});

test('mandatory security/native owners cannot be missing, skipped or replaced by status alone', async t => {
  for (const name of fixture().checks.map(c => c.name)) {
    for (const result of ['missing', 'skipped', 'neutral']) await t.test(`${name}/${result}`, async () => {
      const f = fixture();
      if (result === 'missing') f.checks = f.checks.filter(c => c.name !== name);
      else f.checks.find(c => c.name === name).conclusion = result;
      f.statuses = [{ context: name, state: 'success', performed_via_github_app: { id: 15368 } }];
      const plan = await f.preview();
      assert.ok(plan.members[0].blockers.some(b => b.includes(name)));
      await assert.rejects(f.helper.execute(plan));
      assert.equal(f.writes().length, 0);
    });
  }
});

test('matrix jobs and partial reruns bind exact latest executions and retain failed attempts', async () => {
  const f = fixture();
  f.checks.push({ name: 'build (macos, arm64)', status: 'completed', conclusion: 'success' },
    { name: 'build (linux, musl)', status: 'completed', conclusion: 'success' });
  f.currentRun.run_attempt = 2;
  f.jobOverrides = c => ({ run_attempt: c.name.startsWith('build') ? 2 : 1 });
  f.extraChecks = pr => [{ id: pr.number * 100000, name: 'build (macos, arm64)', head_sha: pr.head.sha,
    app: { id: 15368, slug: 'github-actions' }, check_suite: { id: f.run(pr).check_suite_id },
    details_url: `https://github.com/arcee-ai/nac/actions/runs/${f.run(pr).id}/job/${pr.number * 100000}`,
    status: 'completed', conclusion: 'failure', output: { summary: 'old matrix failure' } }];
  for (const pr of f.prs) f.oldJobs[pr.number * 100000] = { id: pr.number * 100000,
    name: 'build (macos, arm64)', status: 'completed', conclusion: 'failure', run_id: f.run(pr).id,
    head_sha: pr.head.sha, run_attempt: 1,
    check_run_url: `https://api.github.com/${root}/check-runs/${pr.number * 100000}` };
  const plan = await f.preview();
  assert.deepEqual(plan.members[0].blockers, []);
  const old = plan.members[0].records.find(r => r.state === 'failure');
  assert.equal(old.disposition, 'superseded');
  assert.equal(old.output.summary, 'old matrix failure');
  assert.equal(old.supersededBy.attempt, 2);
  assert.equal(plan.members[0].checkProvenance.superseded.find(s => s.check === old.id).attempt, 1);
  assert.ok(plan.members[0].checkProvenance.jobs.some(j => j.attempt === 1), 'untouched jobs are explicitly carried');
  f.oldJobs[1100000].run_attempt = 2;
  assert.match((await f.preview()).members[0].blockers.join(), /Partial-rerun supersession is ambiguous/);
  assert.equal(f.writes().length, 0);
  const duplicate = fixture();
  duplicate.checks.push({ ...duplicate.checks[0] });
  assert.match((await duplicate.preview()).members[0].blockers.join(), /ambiguous latest matrix jobs/);
});

test('later-page matrix failure and newly appearing runs fail closed', async () => {
  const f = fixture();
  f.checks.push(...Array.from({ length: 99 }, (_, i) => ({ name: `matrix (${i})`,
    status: 'completed', conclusion: i === 98 ? 'failure' : 'success' })));
  const plan = await f.preview();
  assert.match(plan.members[0].blockers.join(), /matrix \(98\): failure/);
  assert.ok(f.calls.some(c => c.endpoint.includes('/jobs?') && c.endpoint.endsWith('page=2')));
  await assert.rejects(f.helper.execute(plan));
  assert.equal(f.writes().length, 0);

  const g = fixture(); let reads = 0;
  g.onRunsRead = (current, pr) => {
    if (pr.number === 11 && ++reads === 2) current.extraRuns = p => [{ ...current.run(p),
      id: 9000, workflow_id: 200, path: '.github/workflows/new.yml', status: 'queued', conclusion: null }];
  };
  assert.match((await g.preview()).members[0].blockers.join(), /Workflow inventory changed/);
  assert.equal(g.writes().length, 0);
});

test('changed workflow attempt and PR head/base bookends cannot authorize a request', async () => {
  const f = fixture(); let reads = 0;
  f.onRunRead = current => { if (++reads === 2) current.currentRun.run_attempt = 2; };
  assert.match((await f.preview()).members[0].blockers.join(), /attempt changed/);
  assert.equal(f.writes().length, 0);
  for (const field of ['head', 'base']) {
    const g = fixture();
    g.onReviewRead = current => { current.prs[0][field].sha = sha('f'); };
    await assert.rejects(g.preview(), /head\/base.*changed/);
    assert.equal(g.writes().length, 0);
  }
});

test('a newly changed check/status inventory cannot reuse a prior green snapshot', async () => {
  for (const type of ['check', 'status']) {
    const f = fixture(); let reads = 0;
    if (type === 'check') f.onChecksRead = current => {
      if (++reads === 2) current.checks[0].status = 'in_progress';
    };
    else f.onStatusesRead = current => {
      if (++reads === 2) current.statuses = [{ id: 1, context: 'new gate', state: 'pending' }];
    };
    const plan = await f.preview();
    assert.match(plan.members[0].blockers.join(), /Check\/status inventory changed/);
    assert.equal(f.writes().length, 0);
  }
});

test('positively associated PRtarget pipelines are gates before any check row exists', async t => {
  for (const [status, conclusion] of [['queued', null], ['in_progress', null],
    ['completed', 'failure'], ['completed', 'cancelled']]) await t.test(`${status}/${conclusion}`, async () => {
    const f = fixture();
    f.extraRuns = pr => [{ ...f.run(pr), id: 9000, workflow_id: 200,
      path: '.github/workflows/cla.yml', event: 'pull_request_target', status, conclusion }];
    const plan = await f.preview();
    assert.match(plan.members[0].blockers.join(), /Workflow 9000 attempt 1/);
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
  const good = fixture();
  good.extraRuns = pr => [{ ...good.run(pr), id: 9000, workflow_id: 200,
    path: '.github/workflows/cla.yml', event: 'pull_request_target' }];
  assert.deepEqual((await good.preview()).members[0].blockers, []);
  good.extraRuns = pr => [{ ...good.run(pr), id: 9000, workflow_id: 200,
    path: '.github/workflows/cla.yml', event: 'unknown_event' }];
  assert.match((await good.preview()).members[0].blockers.join(), /event.*unproven/);
});

test('native stack prepared bases qualify only by current merge and exact complete trees', async () => {
  const f = fixture(); f.syntheticBase = true;
  const plan = await f.preview();
  assert.ok(plan.members.every(m => m.blockers.length === 0));
  assert.equal(plan.members[1].checkProvenance.selected.testedMerge, sha('8'));
  assert.equal(f.writes().length, 0);
});

test('current-merge identity, exact head, known trees and API failures stay closed', async t => {
  const cases = {
    wrongM: f => { f.prs[0].merge_commit_sha = sha('f'); },
    missingM: f => { f.mergeRefOverrides = { object: null }; },
    wrongHeadParent: f => { f.commitOverrides = { parents: [{ sha: sha('b') }, { sha: sha('f') }] }; },
    extraParent: f => { f.commitOverrides = { parents: [{ sha: sha('b') }, { sha: sha('a') }, { sha: sha('f') }] }; },
    missingParent: f => { f.commitOverrides = { parents: [{ sha: sha('a') }] }; },
    wrongMergeTree: f => { f.commitOverrides = { tree: { sha: sha('f') } }; },
    missingTree: f => { f.commitOverrides = { tree: null }; },
    wrongCommitResponse: f => { f.commitOverrides = { sha: sha('f') }; },
    unavailableAPI: f => { f.unavailableCommit = sha('9'); },
    unknownAssociatedHead: f => { f.extraRuns = pr => [{ ...f.run(pr), id: 9000, workflow_id: 200,
      path: '.github/workflows/cla.yml', event: 'pull_request_target', head_sha: sha('f') }]; },
    unknownAssociatedRepo: f => { f.extraRuns = pr => [{ ...f.run(pr), id: 9000, workflow_id: 200,
      path: '.github/workflows/cla.yml', event: 'pull_request_target', repository: { full_name: 'other/repo' } }]; },
    unknownAssociatedBase: f => { f.extraRuns = pr => { const p = clone(pr); p.base.sha = sha('f'); return [{
      ...f.run(pr), id: 9000, workflow_id: 200, path: '.github/workflows/cla.yml',
      event: 'pull_request_target', pull_requests: [p] }]; }; },
  };
  for (const [label, change] of Object.entries(cases)) await t.test(label, async () => {
    const f = fixture(); change(f);
    const plan = await f.preview();
    assert.ok(plan.members[0].blockers.length, label);
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
  const changed = fixture();
  changed.onReviewRead = current => { current.prs[0].merge_commit_sha = sha('f'); };
  await assert.rejects(changed.preview(), /current merge changed/);
  assert.equal(changed.writes().length, 0);
});

test('pinned REST shape can omit legacy merge_commit_sha while canonical merge refs stay required', async () => {
  const f = fixture();
  for (const pr of f.prs) delete pr.merge_commit_sha;
  assert.deepEqual((await f.preview()).members.map(m => m.blockers), [[], []]);
  f.mergeRefOverrides = { ref: 'refs/pull/999/merge' };
  const plan = await f.preview();
  assert.match(plan.members[0].blockers.join(), /merge ref is unavailable/);
  await assert.rejects(f.helper.execute(plan));
  assert.equal(f.writes().length, 0);
});

test('complete base trees reject changed modes, blobs, extra and missing paths', async t => {
  const object = (type, bytes) => createHash('sha1').update(Buffer.concat([
    Buffer.from(`${type} ${bytes.length}\0`), bytes,
  ])).digest('hex');
  const blob = value => object('blob', Buffer.from(value));
  const tree = entries => object('tree', Buffer.concat(entries.map(([mode, name, value]) =>
    Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(value, 'hex')]))));
  const original = [['100644', 'file.txt', blob('original')]];
  const variants = { mode: [['100755', 'file.txt', blob('original')]],
    blob: [['100644', 'file.txt', blob('changed')]], missing: [],
    extra: [...original, ['100644', 'z-extra.txt', blob('extra')]] };
  for (const [label, entries] of Object.entries(variants)) await t.test(label, async () => {
    const f = fixture(); f.syntheticBase = true;
    f.trees = { [sha('a')]: tree(original) };
    f.preparedBaseTree = tree(entries);
    const plan = await f.preview();
    assert.match(plan.members[1].blockers.join(), /Prepared base tree differs/);
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  });
});

test('wrong login, numeric identity, type and expanded bypass each cause zero mutations', async () => {
  for (const changes of [{ login: 'another' }, { id: 1 }, { type: 'Bot' }]) {
    const f = fixture(), plan = await f.preview();
    Object.assign(f.viewer, changes);
    await assert.rejects(f.helper.execute(plan), /requires allisoneer/);
    await assert.rejects(f.preview(), /requires allisoneer/);
    assert.equal(f.writes().length, 0);
  }
  const f = fixture(), plan = await f.preview();
  f.review.bypass_actors[0].bypass_mode = 'always';
  await assert.rejects(f.helper.execute(plan), /bypass policy differs/);
  assert.equal(f.writes().length, 0);
});

test('exact lowest requests, returned UUID, pending to merged and unchanged automatic rebase', async () => {
  const f = fixture(), plan = await f.preview();
  assert.deepEqual(await f.helper.execute(plan), { landed: [11, 12], remaining: [] });
  assert.deepEqual(f.writes().map(w => [w.endpoint, w.body]), [
    [`${root}/pulls/11/merge-async`, { merge_method: 'squash', merge_action: 'default', sha: sha('a'), bypass_rules: true }],
    [`${root}/pulls/12/merge-async`, { merge_method: 'squash', merge_action: 'default', sha: sha('e'), bypass_rules: true }],
  ]);
  assert.ok(f.calls.some(c => c.endpoint === `${root}/pulls/11/merge-async/${uuid}`));
  assert.deepEqual(f.stack().pull_requests.map(p => [p.number, p.state]), [[11, 'closed'], [12, 'closed']]);
});

test('new plan on an already partially merged stack preserves retained history and absolute positions', async () => {
  const f = fixture();
  f.land(11);
  const plan = await f.helper.preview(99, [12]);
  assert.deepEqual(plan.membership, [11, 12]);
  assert.deepEqual(plan.members.map(p => p.number), [12]);
  assert.deepEqual(await f.helper.execute(plan), { landed: [12], remaining: [] });
  assert.equal(f.writes().length, 1);
  assert.equal(f.writes()[0].endpoint, `${root}/pulls/12/merge-async`);
});

test('wrong declared order, unknown members, stale head/base, content, draft or conflict fail closed', async () => {
  for (const change of [
    f => f.prs.reverse(), f => f.prs.push({ ...f.prs[1], number: 13 }),
    f => { f.prs[0].head.sha = sha('f'); f.prs[1].base.sha = sha('f'); },
    f => { f.prs[0].base.sha = sha('f'); }, f => { f.text = 'author pushed'; },
    f => { f.prs[0].draft = true; }, f => { f.prs[0].mergeable = false; },
    f => { f.prs[0].mergeable = null; }, f => { f.unresolved = true; },
    f => { f.checks[0].status = 'in_progress'; }, f => { f.checks[1].conclusion = 'failure'; },
    f => { f.checks = []; }, f => { f.universal.bypass_actors.push({ actor_id: 1 }); },
    f => { f.prs[0].state = 'closed'; },
  ]) {
    const f = fixture(), plan = await f.preview();
    change(f);
    await assert.rejects(f.helper.execute(plan));
    assert.equal(f.writes().length, 0);
  }
});

test('partial landing stops on unexplained content, membership, trunk or policy changes', async () => {
  for (const change of [
    f => { f.text = 'unexpected author code'; },
    f => { f.prs.push({ ...f.prs[1], number: 13 }); },
    f => { f.prs[1].base.sha = sha('f'); },
    f => { f.rules.push({ ruleset_id: 1, type: 'required_signatures' }); },
    f => { f.prs[1].draft = true; }, f => { f.checks[0].status = 'in_progress'; },
    f => { f.fileSha = sha('8'); },
    f => { const stack = f.stack; f.stack = () => ({ ...stack(), pull_requests: stack().pull_requests.slice(1) }); },
  ]) {
    const f = fixture(), plan = await f.preview();
    f.afterLanding = change;
    await assert.rejects(f.helper.execute(plan), /"landed":\[11\],"remaining":\[12\]/);
    assert.equal(f.writes().length, 1);
  }
});

test('queued, failed, unknown, forbidden, timeout each stop without another member request', async () => {
  for (const [status, message] of [['enqueued', /Queued, not merged/], ['failed', /Merge stopped/],
    ['surprise', /Merge stopped/], ['pending', /Timed out/], ['forbidden', /HTTP 403/]]) {
    const f = fixture(), plan = await f.preview();
    f.results = [status];
    if (status === 'forbidden') f.responseStatus = 403;
    await assert.rejects(f.helper.execute(plan), message);
    assert.equal(f.writes().length, 1);
  }
});

test('409 inspects actual existing request options/result and never duplicates the member request', async () => {
  const f = fixture(), plan = await f.preview();
  f.responseStatus = 409;
  await f.helper.execute(plan);
  assert.equal(f.writes().length, 2);
  for (const optionOverrides of [{ merge_action: 'direct_merge' }, { merge_method: 'merge' },
    { expected_head_sha: sha('f') }, { bypass_rules: false }, { uuid: 'invalid' }]) {
    const f = fixture(), plan = await f.preview();
    f.responseStatus = 409;
    f.optionOverrides = optionOverrides;
    await assert.rejects(f.helper.execute(plan), /request options differ|valid returned request UUID/);
    assert.equal(f.writes().length, 1);
  }
});

test('immediate merged response is confirmed; false merged claims cannot advance', async () => {
  const f = fixture(), plan = await f.preview();
  f.responseStatus = 200;
  await f.helper.execute(plan);
  const g = fixture(), secondPlan = await g.preview();
  g.land = () => ({ status: 'merged', details: { sha: sha('d') } });
  await assert.rejects(g.helper.execute(secondPlan), /not confirmed/);
  assert.equal(g.writes().length, 1);
});

test('transport loss retains the uncertain active member, never retries or advances', async () => {
  const f = fixture(), plan = await f.preview();
  const transport = async (...args) => {
    if (args[0] === 'PUT') { f.calls.push({ method: 'PUT' }); throw new Error('connection lost'); }
    return f.transport(...args);
  };
  await assert.rejects(createHelper(transport).execute(plan),
    /connection lost[\s\S]*"active":\{"number":11,"uuid":null\}/);
  assert.equal(f.writes().length, 1);
});

test('review/check pagination includes later-page blockers', async () => {
  for (const kind of ['checks', 'reviews']) {
    const f = fixture(), transport = f.transport;
    f.transport = async (...args) => transport(...args);
    const paginated = async (method, endpoint, body, accept) => {
      if (kind === 'checks' && endpoint.includes('/check-runs?')) {
        return { status: 200, body: { check_runs: endpoint.endsWith('page=1')
          ? Array.from({ length: 100 }, () => f.checks[0])
          : [{ ...f.checks[1], conclusion: 'failure' }] } };
      }
      const response = await transport(method, endpoint, body, accept);
      if (kind === 'reviews' && endpoint === 'graphql') {
        const threads = response.body.data.repository.pullRequest.reviewThreads;
        if (!body.variables.cursor) threads.pageInfo = { hasNextPage: true, endCursor: 'next' };
        else threads.nodes = [{ isResolved: false }];
      }
      return response;
    };
    const helper = createHelper(paginated);
    const plan = await helper.preview(99, [11, 12]);
    assert.match(plan.members[0].blockers.join(), kind === 'checks' ? /source-security.*failure/ : /Unresolved/);
    await assert.rejects(helper.execute(plan), /not admissible/);
    assert.equal(f.writes().length, 0);
  }
});

test('delta preserves whitespace/context/mode and rejects binary, truncation, missing files', () => {
  assert.equal(authoredDelta(diff(), [file], 1), authoredDelta(diff(18, 'new', '3333333'), [file], 1));
  assert.notEqual(authoredDelta(diff(), [file], 1), authoredDelta(diff(1, 'new '), [file], 1));
  assert.notEqual(authoredDelta(diff(), [file], 1), authoredDelta(diff().replace('100644', '100755'), [file], 1));
  // Identical diff text at another occurrence can have identical normalized
  // hunks but a different resulting file. Full blob identity closes that gap.
  assert.notEqual(authoredDelta(diff(), [file], 1), authoredDelta(diff(18), [{ ...file, sha: sha('8') }], 1));
  for (const [raw, files, count] of [[diff().replace('+new\n', ''), [file], 1],
    ['diff --git a/file.txt b/file.txt\nBinary files differ\n', [file], 1],
    [diff(), [file], 2], [diff(), [], 0]]) {
    assert.throws(() => authoredDelta(raw, files, count));
  }
});

test('CLI defaults to preview, exclusive private plan creation, no implicit execute', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-stack-plan-'));
  try {
    const f = fixture(), output = [], destination = path.join(directory, 'plan.json');
    const args = ['--stack', '99', '--members', '11,12', '--plan', destination];
    await main(args, { helper: f.helper, out: line => output.push(line) });
    assert.match(output.join('\n'), /exact merge set.*11, 12/);
    assert.match(output.join('\n'), /Partial landing/);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    assert.equal(f.writes().length, 0);
    await assert.rejects(main(args, { helper: f.helper, out: () => {} }), /EEXIST/);
    await assert.rejects(main(['99'], { helper: f.helper }), /Usage/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('fake gh transport fixes host/API version and serializes boolean/options, including HTTP 409', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-fake-gh-'));
  const oldPath = process.env.PATH;
  try {
    const executable = path.join(directory, 'gh');
    fs.writeFileSync(executable, `#!/usr/bin/env node\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{\nconst args=process.argv.slice(2);\nif(!args.includes('github.com')||!args.includes('X-GitHub-Api-Version: 2026-03-10'))process.exit(2);\nconst body=JSON.parse(input);\nif(body.bypass_rules!==true||body.merge_action!=='default')process.exit(3);\nprocess.stdout.write('HTTP/2.0 409 Conflict\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify({status:'pending',details:{uuid:'${uuid}'}}));process.exitCode=1;});\n`, { mode: 0o755 });
    process.env.PATH = `${directory}:${oldPath}`;
    const response = ghTransport('PUT', `${root}/pulls/11/merge-async`, { bypass_rules: true, merge_action: 'default' });
    assert.equal(response.status, 409);
    assert.equal(response.body.details.uuid, uuid);
  } finally { process.env.PATH = oldPath; fs.rmSync(directory, { recursive: true, force: true }); }
});


test('current personal PR policy previews while retaining strict quality', async () => {
  const f = fixture();
  const plan = await f.preview();
  assert.deepEqual(plan.members.map(member => member.number), [11, 12]);
  assert.ok(plan.members.every(member => member.blockers.length === 0));
  assert.equal(f.writes().length, 0);
});

test('personal PR capability never relaxes hard boundaries or quality gates', async () => {
  const cases = [
    ['missing personal checks', f => f.review.rules.pop()],
    ['wrong Actions owner', f => { f.review.rules[1].parameters.required_status_checks[0].integration_id = 200; }],
    ['wrong required context', f => { f.review.rules[1].parameters.required_status_checks[0].context = 'other'; }],
    ['non-strict checks', f => { f.review.rules[1].parameters.strict_required_status_checks_policy = false; }],
    ['create enforcement waived', f => { f.review.rules[1].parameters.do_not_enforce_on_create = true; }],
    ['extra personal actor', f => f.review.bypass_actors.push({ actor_id: 1, actor_type: 'User', bypass_mode: 'pull_request' })],
    ['wrong personal actor', f => { f.review.bypass_actors[0].actor_id = 1; }],
    ['always personal bypass', f => { f.review.bypass_actors[0].bypass_mode = 'always'; }],
    ['personal review weakened', f => { f.review.rules[0].parameters.require_code_owner_review = false; }],
    ['personal threads weakened', f => { f.review.rules[0].parameters.required_review_thread_resolution = false; }],
    ['unexpected personal rule', f => f.review.rules.push({ type: 'required_signatures' })],
    ['universal bypass', f => f.universal.bypass_actors.push({ actor_id: 20910163, actor_type: 'User', bypass_mode: 'pull_request' })],
    ['hard PR boundary absent', f => { f.universal.rules = f.universal.rules.filter(rule => rule.type !== 'pull_request'); }],
    ['hard deletion absent', f => { f.universal.rules = f.universal.rules.filter(rule => rule.type !== 'deletion'); }],
    ['hard force-push boundary absent', f => { f.universal.rules = f.universal.rules.filter(rule => rule.type !== 'non_fast_forward'); }],
    ['personal policy not effective', f => { f.rules = f.rules.filter(rule => rule.ruleset_id !== 26484091); }],
    ['hard policy not effective', f => { f.rules = f.rules.filter(rule => rule.ruleset_id !== 25983949); }],
    ['effective checks misplaced', f => { f.rules.find(rule => rule.type === 'required_status_checks').ruleset_id = 25983949; }],
    ['pending Required gate', f => { f.checks[0].status = 'in_progress'; }],
    ['failed source-security gate', f => { f.checks[1].conclusion = 'failure'; }],
    ['failed native gate', f => { f.checks[2].conclusion = 'failure'; }],
    ['unresolved conversation', f => { f.unresolved = true; }],
  ];
  for (const [name, change] of cases) {
    const f = fixture(), plan = await f.preview();
    change(f);
    await assert.rejects(f.helper.execute(plan), undefined, name);
    assert.equal(f.writes().length, 0, name);
    // Policy failures reject preview; quality findings remain visible blockers.
    if (!name.startsWith('pending ') && !name.startsWith('failed ') && name !== 'unresolved conversation') {
      await assert.rejects(f.preview(), undefined, name);
    } else {
      const held = await f.preview();
      assert.ok(held.members.some(member => member.blockers.length > 0), name);
    }
  }
});
