#!/usr/bin/env node
// Human-only maintenance utility. Never invoke execute from an agent or CI job.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'arcee-ai/nac';
const ROOT = `repos/${REPO}`;
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function ghTransport(method, endpoint, body, accept = 'application/vnd.github+json') {
  const args = ['api', '--hostname', 'github.com', '--include', '--method', method,
    endpoint, '-H', `Accept: ${accept}`, '-H', 'X-GitHub-Api-Version: 2026-03-10'];
  if (body) args.push('--input', '-');
  const result = spawnSync('gh', args, {
    input: body ? JSON.stringify(body) : undefined, encoding: 'utf8',
    timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const response = result.stdout.match(/^HTTP\/\S+ (\d+)[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/);
  insist(response, `gh returned no HTTP response: ${result.stderr}`);
  return { status: Number(response[1]), body: accept.endsWith('.diff') ? response[2] : JSON.parse(response[2]) };
}

// Pin full file blob IDs as well as changed bytes/context/paths/modes. A patch
// with identical text moved to another repeated block is not the same source.
export function authoredDelta(diff, files, expectedFiles) {
  insist(files.length > 0 && files.length < 300 && files.length === expectedFiles,
    'Incomplete/empty or oversized comparison (maximum 299 files)');
  const sections = diff.split(/(?=^diff --git )/m).filter(Boolean);
  insist(sections.length === files.length, 'Incomplete diff sections');
  const normalized = sections.map((section, i) => {
    const file = files[i];
    insist(SHA.test(file.sha), 'Comparison lacks a full file blob revision');
    insist(section.startsWith(`diff --git a/${file.previous_filename ?? file.filename} b/${file.filename}\n`),
      'Unsupported quoted path or comparison/diff order mismatch');
    insist(!/^(Binary files |GIT binary patch)/m.test(section), 'Binary changes require separate human handling');
    let additions = 0, deletions = 0, inHunk = false;
    for (const line of section.split('\n')) {
      if (line.startsWith('@@ ')) inHunk = true;
      else if (inHunk && line.startsWith('+')) additions++;
      else if (inHunk && line.startsWith('-')) deletions++;
    }
    insist(additions === file.additions && deletions === file.deletions, 'Truncated or inconsistent diff');
    return `${file.sha}\n${section.replace(/^index [a-f0-9]+\.\.[a-f0-9]+(.*)$/gm, 'index$1')
      .replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, '@@')}`;
  });
  return digest(normalized.join(''));
}

export function createHelper(transport = ghTransport, {
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  timeoutMs = 180_000, log = console.log,
} = {}) {
  async function api(method, path, body, accept) {
    const response = await transport(method, path, body, accept);
    insist(response.status >= 200 && response.status < 300,
      `${method} ${path}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  }
  const get = path => api('GET', `${ROOT}/${path}`);
  async function identity() {
    const viewer = await api('GET', 'user');
    insist(viewer.login === 'allisoneer' && viewer.id === 20910163 && viewer.type === 'User',
      'Execution/preview requires allisoneer / User 20910163 on github.com');
  }
  async function policy() {
    const review = await get('rulesets/26484091');
    const universal = await get('rulesets/25983949');
    const rules = await get('rules/branches/dev');
    insist(review.enforcement === 'active' && review.current_user_can_bypass === 'pull_requests_only' &&
      same(review.bypass_actors, [{ actor_id: 20910163, actor_type: 'User', bypass_mode: 'pull_request' }]) &&
      review.rules.length === 1 && review.rules[0].type === 'pull_request', 'Review-only bypass policy differs');
    insist(universal.enforcement === 'active' && universal.current_user_can_bypass === 'never' &&
      universal.bypass_actors.length === 0 && universal.rules.some(r => r.type === 'pull_request' &&
        r.parameters.required_review_thread_resolution === true) &&
      ['deletion', 'non_fast_forward'].every(type => universal.rules.some(r => r.type === type)),
    'Universal protections differ');
    insist(rules.some(r => r.ruleset_id === 26484091) && rules.some(r => r.ruleset_id === 25983949),
      'Expected dev policies are not effective');
    return { fingerprint: digest(JSON.stringify({ review: {
      enforcement: review.enforcement, bypass_actors: review.bypass_actors, rules: review.rules,
      conditions: review.conditions,
    }, universal: { enforcement: universal.enforcement, bypass_actors: universal.bypass_actors,
      rules: universal.rules, conditions: universal.conditions }, rules })), rules };
  }
  async function pages(path, key) {
    const result = [];
    for (let page = 1; page <= 100; page++) {
      const response = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = key ? response[key] : response;
      insist(Array.isArray(items), 'Invalid paginated response');
      result.push(...items);
      if (items.length < 100) return result;
    }
    throw new Error('Pagination limit exceeded');
  }
  async function validation(pr, rules) {
    const checks = await pages(`commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs');
    const statuses = await pages(`commits/${pr.head.sha}/status`, 'statuses');
    const required = new Set(['Required PR checks', 'source-security / Full locked source scan']);
    for (const rule of rules.filter(r => r.type === 'required_status_checks')) {
      for (const check of rule.parameters.required_status_checks) required.add(check.context);
    }
    const records = [...checks.map(c => ({ name: c.name,
      state: c.status === 'completed' ? c.conclusion : c.status })),
    ...statuses.map(s => ({ name: s.context, state: s.state }))];
    const blockers = records.filter(r => !['success', 'neutral', 'skipped'].includes(r.state) ||
      required.has(r.name) && r.state !== 'success').map(r => `${r.name}: ${r.state}`);
    for (const name of required) if (!records.some(r => r.name === name && r.state === 'success')) {
      blockers.push(`${name}: missing successful result`);
    }
    let cursor = null;
    for (let page = 0; page < 100; page++) {
      const data = await api('POST', 'graphql', { query: `query($number:Int!,$cursor:String) {
        repository(owner:"arcee-ai",name:"nac") { pullRequest(number:$number) {
          headRefOid reviewThreads(first:100,after:$cursor) {
            nodes { isResolved } pageInfo { hasNextPage endCursor }
          }
        } }
      }`, variables: { number: pr.number, cursor } });
      insist(!data.errors && data.data?.repository?.pullRequest?.headRefOid === pr.head.sha,
        'Review query failed or head changed');
      const threads = data.data.repository.pullRequest.reviewThreads;
      if (threads.nodes.some(t => t.isResolved !== true)) blockers.push('Unresolved review conversations');
      if (!threads.pageInfo.hasNextPage) return { records, blockers };
      insist(threads.pageInfo.endCursor && threads.pageInfo.endCursor !== cursor, 'Invalid review pagination');
      cursor = threads.pageInfo.endCursor;
    }
    throw new Error('Review pagination limit exceeded');
  }
  async function snapshot(stackNumber, numbers, currentPolicy, expectedMembership) {
    const stack = await get(`stacks/${stackNumber}`);
    const membership = stack.pull_requests.map(pr => pr.number);
    const entries = stack.pull_requests.filter(pr => pr.state === 'open' && pr.merged_at === null);
    const historySize = membership.length - entries.length;
    insist(stack.number === stackNumber && stack.open === true && stack.base.ref === 'dev' &&
      (!expectedMembership || same(membership, expectedMembership)) &&
      same(entries.map(pr => pr.number), numbers) &&
      stack.pull_requests.slice(0, historySize).every(pr => pr.state === 'closed' && pr.merged_at) &&
      same(stack.pull_requests.slice(historySize).map(pr => pr.number), numbers),
    'Stack membership/order/base changed or contains an unmerged closed member');
    const members = [];
    for (const [i, entry] of entries.entries()) {
      const pr = await get(`pulls/${entry.number}`);
      insist(pr.number === entry.number && pr.stack?.number === stackNumber && pr.stack.position === historySize + i + 1 &&
        pr.stack.size === membership.length && pr.state === 'open' && pr.merged === false &&
        pr.head.repo?.full_name === REPO && pr.base.repo?.full_name === REPO &&
        SHA.test(pr.head.sha) && SHA.test(pr.base.sha) &&
        same([pr.head.ref, pr.head.sha, pr.base.ref, pr.base.sha],
          [entry.head.ref, entry.head.sha, entry.base.ref, entry.base.sha]), 'Inconsistent PR/stack snapshot');
      insist(pr.base.ref === (i ? members[i - 1].head.ref : 'dev') &&
        (!i || pr.base.sha === members[i - 1].head.sha), 'Stack is not a linear chain');
      const comparePath = `${ROOT}/compare/${pr.base.sha}...${pr.head.sha}`;
      const comparison = await api('GET', comparePath);
      insist(comparison.base_commit.sha === pr.base.sha && comparison.status === 'ahead' &&
        comparison.merge_base_commit.sha === pr.base.sha, 'Layer is not based on its declared base revision');
      const diff = await api('GET', comparePath, undefined, 'application/vnd.github.diff');
      const delta = authoredDelta(diff, comparison.files, pr.changed_files);
      const checks = await validation(pr, currentPolicy.rules);
      members.push({ number: pr.number, title: pr.title, head: { ref: pr.head.ref, sha: pr.head.sha },
        base: { ref: pr.base.ref, sha: pr.base.sha }, draft: pr.draft,
        mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, delta, ...checks });
    }
    return { members, membership };
  }
  async function preview(stack, numbers) {
    await identity();
    const currentPolicy = await policy();
    const { members, membership } = await snapshot(stack, numbers, currentPolicy);
    return { version: 1, repository: REPO, stack, created: new Date(now()).toISOString(),
      policy: currentPolicy.fingerprint, membership, members };
  }
  async function execute(plan) {
    const landed = [], remaining = plan.members?.map(m => m.number) ?? [];
    let active = null;
    try {
      insist(plan.version === 1 && plan.repository === REPO && Number.isSafeInteger(plan.stack) && plan.stack > 0 &&
        remaining.length > 0 && remaining.every(n => Number.isSafeInteger(n) && n > 0) &&
        new Set(remaining).size === remaining.length && Array.isArray(plan.membership) &&
        plan.membership.length >= remaining.length, 'Invalid plan');
      await identity();
      let previousMerge = null;
      while (remaining.length) {
        await identity();
        const currentPolicy = await policy();
        insist(currentPolicy.fingerprint === plan.policy, 'Policy changed since preview; create a new plan');
        const { members: current } = await snapshot(plan.stack, remaining, currentPolicy, plan.membership);
        for (const [i, member] of current.entries()) {
          const expected = plan.members[landed.length + i];
          insist(member.head.ref === expected.head.ref && member.delta === expected.delta &&
            member.base.ref === (i ? current[i - 1].head.ref : 'dev'), 'Authored content or refs changed');
          if (!landed.length) insist(same(member.head, expected.head) && same(member.base, expected.base),
            'Revision changed since preview; create a new plan');
          else if (!i) insist(member.base.sha === previousMerge, 'Unexpected trunk advance after partial merge');
          insist(member.draft === false && member.mergeable === true &&
            !['dirty', 'unknown'].includes(member.mergeable_state) && member.blockers.length === 0,
          `#${member.number} is not admissible: draft=${member.draft}, mergeable=${member.mergeable}, ${member.blockers.join('; ')}`);
        }
        // Close the read window before the pinned-head request. The server remains
        // authoritative; no client can atomically lock stack/policy/check state.
        const lowest = current[0];
        const fresh = await get(`stacks/${plan.stack}`);
        insist(same(fresh.pull_requests.map(p => p.number), plan.membership) &&
          same(fresh.pull_requests.filter(p => p.state === 'open' && p.merged_at === null)
            .map(p => [p.number, p.head.sha, p.base.ref, p.base.sha]),
          current.map(p => [p.number, p.head.sha, p.base.ref, p.base.sha])), 'Stack changed during validation');
        await identity();
        const options = { merge_method: 'squash', merge_action: 'default', sha: lowest.head.sha, bypass_rules: true };
        const endpoint = `${ROOT}/pulls/${lowest.number}/merge-async`;
        active = { number: lowest.number, uuid: null };
        const response = await transport('PUT', endpoint, options);
        insist([200, 202, 409].includes(response.status), `Merge rejected: HTTP ${response.status} ${JSON.stringify(response.body)}`);
        let result = response.body;
        active = { number: lowest.number, uuid: result.details?.uuid ?? null };
        if ([202, 409].includes(response.status)) {
          insist(UUID.test(active.uuid ?? ''), 'No valid returned request UUID; inspect GitHub before retrying');
          const details = result.details;
          insist(result.status === 'pending' && details.merge_method === options.merge_method &&
            details.merge_action === options.merge_action && details.expected_head_sha === options.sha &&
            details.bypass_rules === true, 'Existing/accepted request options differ; inspect it; do not retry');
          const deadline = now() + timeoutMs;
          do {
            insist(now() < deadline, `Timed out; request ${active.uuid} may still finish; inspect before retrying`);
            result = await api('GET', `${endpoint}/${active.uuid}`);
            if (result.status === 'pending') await sleep(2000);
          } while (result.status === 'pending');
        }
        insist(result.status === 'merged', `${result.status === 'enqueued' ? 'Queued, not merged' : 'Merge stopped'}: ${JSON.stringify(result)}`);
        const merged = await get(`pulls/${lowest.number}`);
        insist(merged.merged === true && merged.head.sha === lowest.head.sha && SHA.test(merged.merge_commit_sha) &&
          merged.merge_commit_sha === result.details?.sha, 'Merge result is not confirmed by PR state');
        previousMerge = merged.merge_commit_sha;
        landed.push(remaining.shift());
        active = null;
        log(`Landed #${lowest.number} at ${previousMerge}; remaining: ${remaining.join(', ') || 'none'}`);
      }
      return { landed, remaining };
    } catch (error) {
      throw new Error(`${error.message}\nProgress: ${JSON.stringify({ landed, remaining, active })}. Stop; partial landing is possible. No automatic retry.`, { cause: error });
    }
  }
  return { preview, execute };
}

export async function main(args, { helper = createHelper(), out = console.log } = {}) {
  if (args.length === 2 && args[0] === '--execute') {
    await helper.execute(JSON.parse(fs.readFileSync(args[1], 'utf8')));
    return;
  }
  insist(args.length === 6 && args[0] === '--stack' && args[2] === '--members' && args[4] === '--plan',
    'Usage (read-only): node scripts/manual-stack-override.mjs --stack NUMBER --members BOTTOM,TOP --plan /absolute/plan.json\nHuman execution: node scripts/manual-stack-override.mjs --execute /absolute/plan.json');
  const stack = Number(args[1]), members = args[3].split(',').map(Number);
  insist(Number.isSafeInteger(stack) && stack > 0 && members.every(n => Number.isSafeInteger(n) && n > 0) &&
    new Set(members).size === members.length, 'Invalid stack/member numbers');
  const plan = await helper.preview(stack, members);
  out(`PREVIEW ONLY: ${REPO} stack ${stack}; exact merge set (bottom to top): ${members.join(', ')}\nSequential squash/default routing; review-only bypass. Partial landing is possible; queued is not merged.`);
  out(`Full stack membership (including retained merged members): ${plan.membership.join(', ')}`);
  for (const member of plan.members) out(JSON.stringify(member, null, 2));
  fs.writeFileSync(args[5], `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  out(`Saved ${args[5]}. Review every member and blocker. Only a human may explicitly execute this plan.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
