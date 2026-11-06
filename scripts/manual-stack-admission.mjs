// Consumer of the immutable v2 admission contract. A metadata observation is
// never quality evidence: independently find FULL, then prove every pointer.
import { createHash } from 'node:crypto';

const REPO = 'arcee-ai/nac';
const REPO_ID = 1194218201;
const WORKFLOW = '.github/workflows/stable-release.yml';
const UNIT = '.github/workflows/ci-admission.yml';
const FULL = 'ci-admission / NAC full admission v2 ';
const PURE = 'ci-admission / NAC metadata observation v2 ';
const AUTHORITY = ['.github/scripts/ci-admission.py', '.github/scripts/ci-admission-bootstrap.py',
  '.github/scripts/ci-admission-applicability.json', '.github/scripts/ci-admission-contract.json',
  '.github/scripts/cold-caches.py', '.github/scripts/pr-checks.mjs', '.github/scripts/publication-policy.mjs'];
const SHA = /^[a-f0-9]{40}$/;
const insist = (value, message) => { if (!value) throw new Error(`Admission: ${message}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Match Python's compact ensure_ascii JSON, including UTF-16 surrogate pairs.
const digest = value => hash(JSON.stringify(value).replace(/[\u007f-\uffff]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

export function cold(body) {
  insist(body == null || typeof body === 'string', 'malformed PR body');
  const marker = '<!-- nac-ci-cold-caches -->';
  return body != null && (body === marker || body.startsWith(`${marker}\n`) || body.startsWith(`${marker}\r\n`));
}

async function currentTuple(pr, prepared, { commit, get }) {
  insist(pr.base.repo?.id === REPO_ID && pr.base.repo.full_name === REPO &&
    Number.isSafeInteger(pr.head.repo?.id) && pr.head.repo.id > 0 &&
    Number.isSafeInteger(pr.number) && pr.number > 0 &&
    [pr.base.ref, pr.head.ref].every(r => typeof r === 'string' && r.length > 0 && r.length <= 255),
  'current repository/ref identity is unavailable');
  const [base, head, merged] = await Promise.all([commit(pr.base.sha), commit(pr.head.sha), commit(prepared)]);
  insist(merged.parents?.length === 2 && merged.parents[0].sha === pr.base.sha &&
    merged.parents[1].sha === pr.head.sha && merged.tree.sha === head.tree.sha,
  'prepared merge does not bind exact current base/head/tree');
  const cache = new Map();
  async function tree(sha) {
    if (cache.has(sha)) return cache.get(sha);
    const value = await get(`git/trees/${sha}?recursive=1`);
    insist(value.sha === sha && value.truncated === false && Array.isArray(value.tree) && value.tree.length > 0 &&
      new Set(value.tree.map(e => e.path)).size === value.tree.length && value.tree.every(e =>
        typeof e.path === 'string' && e.path.length > 0 && !e.path.includes('\0') && SHA.test(e.sha) &&
        ({ blob: ['100644', '100755', '120000'], tree: ['040000'], commit: ['160000'] })[e.type]?.includes(e.mode)),
    'incomplete or unsupported Git tree');
    const leaves = new Map(value.tree.filter(e => e.type !== 'tree').map(e => [e.path, e]));
    cache.set(sha, leaves);
    return leaves;
  }
  const trees = await Promise.all([tree(base.tree.sha), tree(head.tree.sha), tree(merged.tree.sha)]);
  const workflows = trees.map(t => [...t.keys()].filter(p => p.startsWith('.github/workflows/')).sort());
  insist(workflows[0].includes(WORKFLOW) && workflows[0].includes(UNIT) &&
    workflows[0].every(p => /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(p)) &&
    workflows.every(w => JSON.stringify(w) === JSON.stringify(workflows[0])), 'workflow inventory changed');
  const paths = [...workflows[0], ...AUTHORITY].sort();
  const bytes = new Map();
  const hashes = [];
  for (const path of paths) {
    const entry = trees[0].get(path);
    insist(entry?.type === 'blob' && ['100644', '100755'].includes(entry.mode) && trees.every(t =>
      t.get(path)?.sha === entry.sha && t.get(path)?.mode === entry.mode && t.get(path)?.type === entry.type),
    'workflow/admission authority differs from immutable base');
    const blob = await get(`git/blobs/${entry.sha}`);
    insist(blob.sha === entry.sha && blob.encoding === 'base64' && Number.isSafeInteger(blob.size) &&
      blob.size >= 0 && blob.size <= 2 * 1024 * 1024 && typeof blob.content === 'string' &&
      /^[A-Za-z0-9+/=\r\n]*$/.test(blob.content), 'unavailable authority bytes');
    const raw = Buffer.from(blob.content, 'base64');
    insist(raw.length === blob.size && createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex') === entry.sha,
      'authority blob identity mismatch');
    hashes.push([path, hash(raw)]);
    bytes.set(path, raw);
  }
  const policy = JSON.parse(bytes.get(AUTHORITY[2]).toString('utf8'));
  const prefixes = ['.github/', 'crates/', 'docker/managed/', 'scripts/'];
  const exact = ['Cargo.toml', 'Cargo.lock', 'Makefile', '.dockerignore', 'version.txt'];
  insist(JSON.stringify(Object.keys(policy).sort()) === JSON.stringify(['exact_paths', 'pr_checks_sha256', 'prefixes', 'schema_version']) &&
    policy.schema_version === 1 && policy.pr_checks_sha256 === hash(bytes.get('.github/scripts/pr-checks.mjs')) &&
    JSON.stringify(policy.prefixes) === JSON.stringify(prefixes) && JSON.stringify(policy.exact_paths) === JSON.stringify(exact),
  'unsupported immutable applicability policy');
  // Complete no-renames leaf diff, including mode changes, deletes and gitlinks.
  const changed = [...new Set([...trees[0].keys(), ...trees[2].keys()])].filter(path => {
    const a = trees[0].get(path), b = trees[2].get(path);
    return a?.sha !== b?.sha || a?.mode !== b?.mode || a?.type !== b?.type;
  });
  const managed = changed.some(p => prefixes.some(prefix => p.startsWith(prefix)) || exact.includes(p));
  const values = [2, REPO_ID, REPO, pr.number, pr.head.repo.id, pr.head.sha, REPO_ID,
    pr.base.ref, pr.base.sha, prepared, merged.tree.sha, pr.base.sha, WORKFLOW, prepared,
    digest(hashes), cold(pr.body), managed];
  return { digest: digest(values), values };
}

export async function selectFullAdmission(pr, stable, latest, { load, commit, get, checks, mandatory }) {
  const first = await load(latest);
  if (!first.jobs.some(j => j.name.startsWith(PURE))) return { selected: first, observations: [] };
  const ordered = [...stable].sort((a, b) => b.run_number - a.run_number);
  insist(new Set(ordered.map(r => r.id)).size === ordered.length &&
    new Set(ordered.map(r => r.run_number)).size === ordered.length, 'ambiguous Stable interval');
  let tuple, prepared;
  const observations = [];
  for (const listed of ordered) {
    // A finite interval; unknown/pending work never permits a search for green.
    insist(observations.length < 40, 'admission interval exceeds proof budget');
    const item = await load(listed), { run, jobs } = item;
    insist(run.run_attempt === 1 && run.repository.id === REPO_ID &&
      run.head_repository.id === pr.head.repo.id && run.pull_requests[0].head.repo.id === pr.head.repo.id &&
      run.pull_requests[0].base.repo.id === REPO_ID, 'unsupported run/repository identity');
    const prefix = `${REPO}/${UNIT}@`;
    const units = run.referenced_workflows?.filter(r => r.path?.startsWith(prefix));
    insist(units?.length === 1 && SHA.test(units[0].sha) && units[0].path === prefix + units[0].sha &&
      units[0].ref === `refs/pull/${pr.number}/merge`, 'missing/ambiguous provider unit attestation');
    if (!tuple) {
      prepared = units[0].sha;
      tuple = await currentTuple(pr, prepared, { commit, get });
    }
    insist(units[0].sha === prepared, 'changed prepared source in admission interval');
    const markers = jobs.filter(j => j.name.startsWith(PURE) || j.name.startsWith(FULL));
    insist(markers.length === 1 && markers[0].run_attempt === 1 && markers[0].status === 'completed' &&
      markers[0].conclusion === 'success' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(markers[0].started_at),
    'missing/unknown admission marker');
    const marker = markers[0];
    if (marker.name.startsWith(FULL)) {
      insist(marker.name === FULL + tuple.digest, 'FULL tuple differs from current inputs');
      const binding = digest([2, tuple.digest, run.id, 1]);
      insist(observations.every(o => o.binding === binding), 'metadata pointer is not the newest FULL');
      return { selected: item, observations, tuple };
    }
    const binding = marker.name.slice(PURE.length);
    const suiteChecks = checks.filter(c => c.check_suite?.id === run.check_suite_id);
    insist(/^[a-f0-9]{64}$/.test(binding) && run.status === 'completed' && run.conclusion === 'success' &&
      jobs.every(j => j.run_attempt === 1) && !jobs.some(j => mandatory.includes(j.name)) &&
      !suiteChecks.some(c => mandatory.includes(c.name)) && suiteChecks.length === jobs.length,
    'metadata run is pending, ambiguous or claims protected quality contexts');
    observations.push({ run: run.id, attempt: 1, suite: run.check_suite_id, binding, prepared });
  }
  throw new Error('Admission: no proven FULL in complete interval');
}
