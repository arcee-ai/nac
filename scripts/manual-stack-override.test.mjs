import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authoredDelta, createHelper, ghTransport, main } from './manual-stack-override.mjs';

const sha = letter => letter.repeat(40);
const root = 'repos/arcee-ai/nac';
const uuid = '630b9d5e-3f2a-4f7e-8b0c-2d5f9a8c1e42';
const clone = value => structuredClone(value);
const file = { filename: 'file.txt', additions: 1, deletions: 1 };
function diff(offset = 1, text = 'new', blob = '2222222') {
  return `diff --git a/file.txt b/file.txt\nindex 1111111..${blob} 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -${offset} +${offset} @@\n-old\n+${text}\n`;
}

function fixture() {
  const repo = { full_name: 'arcee-ai/nac' };
  const make = (number, head, base, baseRef) => ({ number, title: `Layer ${number}`, state: 'open',
    merged: false, merged_at: null, draft: false, mergeable: true, mergeable_state: 'blocked', changed_files: 1,
    head: { ref: `codex/${number}`, sha: sha(head), repo }, base: { ref: baseRef, sha: sha(base), repo } });
  const f = { prs: [make(11, 'a', 'b', 'dev'), make(12, 'c', 'a', 'codex/11')],
    viewer: { login: 'allisoneer', id: 20910163, type: 'User' }, calls: [],
    responseStatus: 202, results: ['pending', 'merged'], text: 'new', offset: 1,
    checks: ['Required PR checks', 'source-security / Full locked source scan'].map(name =>
      ({ name, status: 'completed', conclusion: 'success' })), unresolved: false, time: 0,
    review: { enforcement: 'active', current_user_can_bypass: 'pull_requests_only',
      bypass_actors: [{ actor_id: 20910163, actor_type: 'User', bypass_mode: 'pull_request' }],
      rules: [{ type: 'pull_request' }] },
    universal: { enforcement: 'active', current_user_can_bypass: 'never', bypass_actors: [], rules: [
      { type: 'deletion' }, { type: 'non_fast_forward' },
      { type: 'pull_request', parameters: { required_review_thread_resolution: true } },
    ] },
    rules: [{ ruleset_id: 26484091, type: 'pull_request' }, { ruleset_id: 25983949, type: 'non_fast_forward' }],
  };
  f.open = () => f.prs.filter(pr => !pr.merged);
  f.stack = () => ({ number: 99, open: true, base: { ref: 'dev' }, pull_requests: clone(f.prs) });
  f.pr = number => {
    const pr = clone(f.prs.find(p => p.number === number));
    pr.stack = { number: 99, size: f.prs.length, position: f.prs.findIndex(p => p.number === number) + 1 };
    return pr;
  };
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
    return { status: 'merged', details: { sha: pr.merge_commit_sha } };
  };
  f.transport = async (method, endpoint, body, accept) => {
    f.calls.push({ method, endpoint, body: clone(body), accept });
    const ok = body => ({ status: 200, body: clone(body) });
    if (endpoint === 'user') return ok(f.viewer);
    if (endpoint.endsWith('/rulesets/26484091')) return ok(f.review);
    if (endpoint.endsWith('/rulesets/25983949')) return ok(f.universal);
    if (endpoint.endsWith('/rules/branches/dev')) return ok(f.rules);
    if (endpoint.endsWith('/stacks/99')) return ok(f.stack());
    if (endpoint === 'graphql') {
      assert.match(body.query, /^query/);
      const pr = f.pr(body.variables.number);
      return ok({ data: { repository: { pullRequest: { headRefOid: pr.head.sha,
        reviewThreads: { nodes: [{ isResolved: !f.unresolved }], pageInfo: { hasNextPage: false } } } } } });
    }
    if (endpoint.includes('/check-runs?')) return ok({ check_runs: f.checks });
    if (endpoint.includes('/status?')) return ok({ statuses: [] });
    if (endpoint.includes('/compare/')) {
      if (accept === 'application/vnd.github.diff') return ok(diff(f.offset, f.text));
      const base = endpoint.split('/compare/')[1].split('...')[0];
      return ok({ base_commit: { sha: base }, merge_base_commit: { sha: base }, status: 'ahead', files: [file] });
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
