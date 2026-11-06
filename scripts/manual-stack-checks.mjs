import { cold, selectFullAdmission } from './manual-stack-admission.mjs';

// NAC's Stable workflow is the owner of the mandatory source/native aggregates.
// Other providers/workflows retain the conservative all-records veto. Unknown
// provenance never turns a failed check into a successful one.
const REPO = 'arcee-ai/nac';
const API = `https://api.github.com/repos/${REPO}`;
const ACTIONS = 15368;
const WORKFLOW = '.github/workflows/stable-release.yml';
const SHA = /^[a-f0-9]{40}$/;
const mandatory = ['Required PR checks', 'source-security / Full locked source scan',
  'macos-native / ARM macOS process and credentials'];
const insist = (value, message) => { if (!value) throw new Error(message); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const sameRepo = repo => repo && (repo.full_name === REPO || repo.url === API) &&
  (repo.full_name == null || repo.full_name === REPO) && (repo.url == null || repo.url === API);
const state = item => item.status === 'completed' ? item.conclusion : item.status;
const action = check => check.app?.id === ACTIONS && check.app?.slug === 'github-actions';
const pair = pr => [pr.number, pr.head.ref, pr.head.sha, pr.base.ref, pr.base.sha];
const repoStamp = repo => [repo?.id, repo?.full_name, repo?.url];
const stamp = run => JSON.stringify([run.id, run.workflow_id, run.path, run.run_number,
  run.check_suite_id, run.run_attempt, run.event, run.head_sha, run.head_branch,
  repoStamp(run.repository), repoStamp(run.head_repository),
  run.pull_requests?.map(p => [pair(p), repoStamp(p.head.repo), repoStamp(p.base.repo)]),
  run.referenced_workflows?.map(r => [r.path, r.ref, r.sha]).sort(),
  run.status, run.conclusion]);
const inventory = runs => JSON.stringify(runs.map(stamp).sort());
const checkStamp = rows => JSON.stringify(rows.map(c => [c.id, c.name, c.head_sha,
  c.status, c.conclusion, c.app?.id, c.app?.slug, c.check_suite?.id]).sort());
const statusStamp = rows => JSON.stringify(rows.map(s => [s.id, s.context, s.state,
  s.performed_via_github_app?.id]).sort());
function numericSuffix(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  return /^[1-9]\d*$/.test(suffix) && positive(Number(suffix)) ? Number(suffix) : null;
}

function context(run, pr, workflow) {
  insist(positive(run.id) && positive(run.run_number) && positive(run.run_attempt) &&
    positive(run.check_suite_id) && run.workflow_id === workflow.id && run.path === WORKFLOW &&
    sameRepo(run.repository) && sameRepo(run.head_repository) && run.event === 'pull_request' &&
    run.head_sha === pr.head.sha && run.head_branch === pr.head.ref,
  'Stable run repository/workflow/event/head provenance is ambiguous');
  const linked = run.pull_requests;
  insist(linked?.length === 1 && JSON.stringify(pair(linked[0])) === JSON.stringify(pair(pr)) &&
    sameRepo(linked[0].head.repo) && sameRepo(linked[0].base.repo),
  'Stable run PR/current-base provenance is ambiguous');
}

function newest(runs) {
  insist(runs.length > 0 && runs.every(r => positive(r.id) && positive(r.run_number) && positive(r.run_attempt)),
    'No unambiguous applicable Stable run');
  const ordered = [...runs].sort((a, b) => b.run_number - a.run_number);
  insist(ordered.length < 2 || ordered[0].run_number !== ordered[1].run_number,
    'Ambiguous latest workflow run');
  return ordered[0];
}

export async function readCurrentMerge(pr, get) {
  const ref = await get(`git/ref/pull/${pr.number}/merge`);
  insist(ref.ref === `refs/pull/${pr.number}/merge` && ref.object?.type === 'commit' && SHA.test(ref.object.sha),
    'Current PR merge ref is unavailable/ambiguous');
  return ref.object.sha;
}

export async function inspectChecks(pr, rules, { get, pages }) {
  const checks = await pages(`commits/${pr.head.sha}/check-runs?filter=all`, 'check_runs');
  const statuses = await pages(`commits/${pr.head.sha}/status`, 'statuses');
  const records = checks.map(c => ({ kind: 'check', id: c.id, name: c.name, state: state(c),
    app: { id: c.app?.id, slug: c.app?.slug }, suite: c.check_suite, head: c.head_sha, output: c.output,
    details_url: c.details_url, started_at: c.started_at, completed_at: c.completed_at,
    disposition: 'current' }));
  records.push(...statuses.map(s => ({ kind: 'status', id: s.id, name: s.context, state: s.state,
    target_url: s.target_url, description: s.description, creator: s.creator,
    app: s.performed_via_github_app, disposition: 'current' })));
  const blockers = [];
  if (checks.some(c => !positive(c.id)) || new Set(checks.map(c => c.id)).size !== checks.length) {
    blockers.push('Check inventory has missing/duplicate execution identities');
  }
  const required = new Map(mandatory.map(name => [name, ACTIONS]));
  for (const rule of rules.filter(r => r.type === 'required_status_checks')) {
    for (const check of rule.parameters.required_status_checks) {
      const app = check.integration_id;
      if (app != null && app !== -1 && !positive(app)) blockers.push(`${check.context}: invalid expected app`);
      if (required.has(check.context) && positive(app) && required.get(check.context) !== app) {
        blockers.push(`${check.context}: conflicting expected app`);
      } else if (!required.has(check.context)) required.set(check.context, positive(app) ? app : null);
    }
  }
  const provenance = { workflow: WORKFLOW, selected: null, jobs: [], merges: [], superseded: [] };
  const authoritative = new Set();
  try {
    const workflow = await get('actions/workflows/stable-release.yml');
    insist(positive(workflow.id) && workflow.path === WORKFLOW && workflow.state === 'active',
      'Stable workflow identity changed');
    const runs = await pages(`actions/runs?head_sha=${pr.head.sha}`, 'workflow_runs');
    // Observe new pending/failing pipelines even before they have check rows.
    // Do not use their names to supersede records from any other pipeline.
    const other = new Map();
    for (const run of runs.filter(r => r.workflow_id !== workflow.id &&
      r.pull_requests?.some(p => p.number === pr.number))) {
      insist(['pull_request', 'pull_request_target'].includes(run.event), 'Other workflow event is unproven');
      insist(positive(run.id) && positive(run.workflow_id) && positive(run.run_number) && positive(run.run_attempt) &&
        typeof run.path === 'string' && sameRepo(run.repository) && sameRepo(run.head_repository) &&
        run.head_sha === pr.head.sha && run.head_branch === pr.head.ref &&
        run.pull_requests.length === 1 && JSON.stringify(pair(run.pull_requests[0])) === JSON.stringify(pair(pr)),
      'Other workflow applicability is ambiguous');
      const key = JSON.stringify([run.workflow_id, run.path, run.event]);
      const prior = other.get(key);
      insist(!prior || prior.run_number !== run.run_number || prior.id === run.id, 'Ambiguous other-workflow run');
      if (!prior || run.run_number > prior.run_number) other.set(key, run);
    }
    for (const run of other.values()) {
      if (run.status !== 'completed' || !['success', 'neutral', 'skipped'].includes(run.conclusion)) {
        blockers.push(`Workflow ${run.id} attempt ${run.run_attempt}: ${state(run)}`);
      }
    }
    const stable = runs.filter(r => r.workflow_id === workflow.id || r.path === WORKFLOW);
    const listed = newest(stable);
    const commits = new Map();
    async function commit(sha) {
      insist(SHA.test(sha), 'Git commit identity is unavailable');
      if (!commits.has(sha)) commits.set(sha, await get(`git/commits/${sha}`));
      const value = commits.get(sha);
      insist(value.sha === sha && SHA.test(value.tree?.sha), 'Git commit/tree identity is unavailable');
      return value;
    }
    async function testedMerge(run, current = false) {
      context(run, pr, workflow);
      const refs = run.referenced_workflows;
      insist(refs?.length > 0 && refs.every(ref => SHA.test(ref.sha) &&
        ref.ref === `refs/pull/${pr.number}/merge` &&
        ref.path.startsWith(`${REPO}/.github/workflows/`) && ref.path.endsWith(`@${ref.sha}`)) &&
        new Set(refs.map(ref => ref.sha)).size === 1, 'Tested merge identity is unavailable/ambiguous');
      const sha = refs[0].sha;
      if (current) {
        provenance.currentMerge = await readCurrentMerge(pr, get);
        insist(sha === provenance.currentMerge, 'Tested merge is not the current PR merge identity');
      }
      const merged = await commit(sha);
      insist(merged.parents?.length === 2 && merged.parents[1].sha === pr.head.sha,
        'Tested merge does not bind the exact current head');
      const parent = merged.parents[0].sha;
      if (parent !== pr.base.sha) insist(positive(pr.stack?.number) && pr.stack.position > 1,
        'Prepared base is not an upper native-stack member');
      // The caller already proved B is H's ancestor in its complete authored
      // comparison. Native stacks prepare B through a lower test merge: qualify
      // its complete tree, including modes/blobs, never arbitrary ancestry.
      const base = await commit(pr.base.sha), head = await commit(pr.head.sha);
      const prepared = await commit(parent);
      insist(prepared.tree.sha === base.tree.sha, 'Prepared base tree differs from current declared base');
      insist(merged.tree.sha === head.tree.sha, 'Tested merge tree differs from the current head');
      if (!provenance.merges.some(m => m.sha === sha)) provenance.merges.push({ sha,
        parents: [parent, pr.head.sha], baseTree: base.tree.sha, preparedBaseTree: prepared.tree.sha,
        headTree: head.tree.sha, mergeTree: merged.tree.sha,
        kind: parent === pr.base.sha ? 'direct' : 'native-stack' });
      return sha;
    }
    const loaded = new Map();
    async function load(listedRun) {
      if (loaded.has(listedRun.id)) {
        const value = loaded.get(listedRun.id);
        insist(stamp(value.run) === stamp(listedRun), 'Conflicting workflow inventories');
        return value;
      }
      const run = await get(`actions/runs/${listedRun.id}`);
      insist(stamp(run) === stamp(listedRun), 'Workflow changed while reading run');
      context(run, pr, workflow);
      insist(stable.some(r => r.id === run.id && stamp(r) === stamp(run)),
        'Head/branch workflow inventories disagree');
      const jobs = await pages(`actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
      insist(jobs.length > 0 && new Set(jobs.map(j => j.name)).size === jobs.length &&
        new Set(jobs.map(j => j.id)).size === jobs.length, 'Missing/ambiguous latest matrix jobs');
      const bound = new Map();
      for (const job of jobs) {
        const id = numericSuffix(job.check_run_url, `${API}/check-runs/`);
        insist(positive(job.id) && job.run_id === run.id && job.head_sha === pr.head.sha &&
          positive(job.run_attempt) && job.run_attempt <= run.run_attempt && id,
        'Latest job run/attempt/head binding is ambiguous');
        const check = checks.find(c => c.id === id);
        insist(check && action(check) && check.head_sha === pr.head.sha &&
          check.check_suite?.id === run.check_suite_id && check.name === job.name &&
          check.status === job.status && check.conclusion === job.conclusion,
        'Latest job/check binding is incomplete or changed');
        bound.set(job.name, { job, check });
      }
      const value = { run, jobs, bound };
      loaded.set(run.id, value);
      return value;
    }
    const admission = await selectFullAdmission(pr, listed,
      { load, commit, get, pages, checks, mandatory });
    const { run: selected, jobs, bound: jobByName } = admission.selected;
    provenance.observations = admission.observations;
    if (admission.tuple) provenance.admission = admission.tuple;
    provenance.selected = { run: selected.id, attempt: selected.run_attempt, suite: selected.check_suite_id };
    insist(selected.status === 'completed' && selected.conclusion === 'success',
      `Latest Stable run ${selected.id} attempt ${selected.run_attempt}: ${state(selected)}`);
    provenance.selected.testedMerge = await testedMerge(selected, true);
    for (const { check } of jobByName.values()) authoritative.add(check.id);
    provenance.jobs = jobs.map(j => ({ id: j.id, name: j.name, attempt: j.run_attempt,
      check_run_url: j.check_run_url, status: j.status, conclusion: j.conclusion }));
    for (const record of records.filter(r => r.kind === 'check')) {
      const check = checks.find(c => c.id === record.id);
      if (!action(check) || authoritative.has(check.id)) continue;
      const matches = stable.filter(r => r.check_suite_id === check.check_suite?.id);
      insist(matches.length < 2, 'Ambiguous historical suite binding');
      const historical = matches[0];
      if (!historical) continue; // Never clear another app/workflow/event by name.
      if (admission.observations.some(o => o.run === historical.id)) continue;
      const merge = await testedMerge(historical);
      let oldAttempt = historical.run_attempt;
      if (historical.id === selected.id) {
        // Partial reruns reuse the suite. Prove this exact old execution was
        // replaced by the job returned by the API's latest-executions view.
        const jobId = numericSuffix(check.details_url, `https://github.com/${REPO}/actions/runs/${selected.id}/job/`);
        insist(jobId, 'Old attempt has no exact job binding');
        const old = await get(`actions/jobs/${jobId}`);
        const replacement = jobByName.get(check.name)?.job;
        insist(old.id === jobId && old.name === check.name &&
          old.status === check.status && old.conclusion === check.conclusion &&
          old.run_id === selected.id && old.head_sha === pr.head.sha &&
          old.check_run_url === `${API}/check-runs/${check.id}` && positive(old.run_attempt) &&
          replacement && old.run_attempt < replacement.run_attempt &&
          replacement.run_attempt <= selected.run_attempt,
        'Partial-rerun supersession is ambiguous');
        oldAttempt = old.run_attempt;
      } else {
        insist(historical.run_number < selected.run_number, 'Historical run is not older');
      }
      record.disposition = 'superseded';
      record.supersededBy = { ...provenance.selected, jobs: provenance.jobs.map(j => j.id) };
      provenance.superseded.push({ check: check.id, run: historical.id,
        attempt: oldAttempt, testedMerge: merge, by: record.supersededBy });
    }
    for (const { run } of loaded.values()) {
      const after = await get(`actions/runs/${run.id}`);
      insist(stamp(after) === stamp(run), 'Workflow attempt changed during validation');
    }
    const laterRuns = await pages(`actions/runs?head_sha=${pr.head.sha}`, 'workflow_runs');
    insist(inventory(laterRuns) === inventory(runs), 'Workflow inventory changed during validation');
    const later = newest(laterRuns.filter(r => r.workflow_id === workflow.id || r.path === WORKFLOW));
    insist(stamp(later) === stamp(listed), 'A newer workflow run appeared during validation');
    if (admission.interval) insist(inventory(await pages(admission.interval.path, 'workflow_runs')) ===
      inventory(admission.interval.runs), 'Stable branch history changed during validation');
    insist(checkStamp(await pages(`commits/${pr.head.sha}/check-runs?filter=all`, 'check_runs')) === checkStamp(checks) &&
      statusStamp(await pages(`commits/${pr.head.sha}/status`, 'statuses')) === statusStamp(statuses),
    'Check/status inventory changed during validation');
    if (admission.tuple) {
      const current = await get(`pulls/${pr.number}`);
      insist(JSON.stringify([pair(current), repoStamp(current.head.repo), repoStamp(current.base.repo), cold(current.body)]) ===
        JSON.stringify([pair(pr), repoStamp(pr.head.repo), repoStamp(pr.base.repo), cold(pr.body)]),
      'Current admission tuple changed during validation');
    }
  } catch (error) {
    // A partly verified mapping must never affect readiness.
    authoritative.clear();
    for (const record of records) { record.disposition = 'current'; delete record.supersededBy; }
    provenance.superseded = [];
    blockers.push(`Check provenance hold: ${error.message}`);
  }
  for (const record of records.filter(r => r.disposition === 'current')) {
    if (!['success', 'neutral', 'skipped'].includes(record.state) ||
      required.has(record.name) && record.state !== 'success') blockers.push(`${record.name}: ${record.state}`);
  }
  for (const check of checks) if (check.head_sha !== pr.head.sha) blockers.push(`${check.name}: check head is unproven`);
  for (const [name, app] of required) {
    const matching = records.filter(r => r.name === name && r.disposition === 'current');
    const eligible = matching.filter(r => r.kind === 'check' && r.state === 'success' &&
      (app == null || r.app?.id === app) && (!mandatory.includes(name) || authoritative.has(r.id)));
    const status = matching.filter(r => r.kind === 'status');
    if (!eligible.length && (mandatory.includes(name) ||
      !status.some(r => r.state === 'success' && (app == null || r.app?.id === app)))) {
      blockers.push(`${name}: missing successful result from the expected owner`);
    }
    if (mandatory.includes(name) && matching.some(r => r.kind === 'check' && !authoritative.has(r.id))) {
      blockers.push(`${name}: current check is not bound to the selected workflow jobs`);
    }
    if (app != null && matching.some(r => r.app?.id !== app)) blockers.push(`${name}: expected app ${app} is unproven`);
  }
  return { records, blockers, checkProvenance: provenance };
}
