import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const options = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const root = path.resolve(options.output);
await fs.mkdir(root, { recursive: false });
const workspace = path.join(root, 'workspace');
for (const dir of ['workspace', 'home', 'nac-home', 'xdg', 'tmp']) await fs.mkdir(path.join(root, dir));
const { ScriptedProvider, ScriptGate } = await import(pathToFileURL(path.join(options.repo, 'crates/nac-server/web/e2e/scripted-provider.ts')));
const longPath = 'src/features/customer-insights/components/conversation/ConversationSummaryPanel.tsx';
const body = "export function ConversationSummaryPanel() {\n  const title = 'Customer insights';\n  return <section aria-label={title}><h2>{title}</h2><p>Review customer conversations.</p><button>Open conversation</button></section>;\n}\n";
await fs.mkdir(path.dirname(path.join(workspace, longPath)), { recursive: true });
await fs.writeFile(path.join(workspace, longPath), body);
await fs.writeFile(path.join(workspace, 'README.md'), '# Customer insights\n\nReview customer conversations and identify a useful next action.\n');
await fs.writeFile(path.join(workspace, 'review-checklist.md'), '# Review checklist\n\n- Check readability\n');
const git = (args, allowFailure = false) => {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' });
  if (result.status && !allowFailure) throw Error(result.stderr);
  return result;
};
git(['init', '-b', 'main']);
git(['config', 'user.name', 'NAC Screenshot Fixture']);
git(['config', 'user.email', 'screenshot-fixture@example.invalid']);
git(['add', '.']); git(['commit', '-m', 'Initial deterministic sample']);
const provider = new ScriptedProvider(); await provider.start();
const server = spawn(options.binary, ['--bind', `127.0.0.1:${options.port}`, '--directory', workspace, '--store-path', path.join(root, 'store.db'), '--worker-executable', options.binary, '--no-open'], {
  cwd: workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: path.join(root, 'home'), NAC_HOME: path.join(root, 'nac-home'), XDG_CONFIG_HOME: path.join(root, 'xdg'), TMPDIR: path.join(root, 'tmp'), BROWSER: 'none', LANG: 'C.UTF-8', NAC_ORCHESTRATION: '1', NAC_E2E_API_KEY: 'nac-e2e-dummy-only', MODELS_DEV_URL: provider.baseUrl + '/models-dev' },
});
const log = await fs.open(path.join(root, 'backend.log'), 'a');
server.stdout.on('data', (data) => log.write(data)); server.stderr.on('data', (data) => log.write(data));
const base = `http://127.0.0.1:${options.port}`;
let ready = false;
for (let attempt = 0; attempt < 200; attempt++) { try { const reply = await fetch(base + '/projects'); if (reply.ok) { ready = true; break; } } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
if (!ready) throw Error('Backend did not start');
const buildBanner = await fs.readFile(path.join(root, 'backend.log'), 'utf8');
if (!buildBanner.includes(options.sha)) throw Error(`Binary banner does not identify expected SHA ${options.sha}`);
const api = async (route, data, method = 'POST') => {
  const reply = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const text = await reply.text();
  if (!reply.ok) throw Error(`${method} ${route}: ${reply.status}: ${text}`);
  return text ? JSON.parse(text) : null;
};
const model = await api('/model-configs', { name: 'Deterministic screenshot provider', backend: 'openai-responses', model: 'gpt-5.6-sol', base_url: provider.baseUrl, api_key: 'nac-e2e-dummy-only', reasoning_effort: 'high', extra_headers: {}, orchestrator_compaction_threshold: 0 });
const project = await api('/projects', { name: 'Customer insights', cwd: workspace, default_model_config_id: model.config_id });
const makeSession = async (title) => {
  const reply = await api('/sessions', { behavior: 'direct', project_id: project.project_id });
  const id = reply.metadata.session_id;
  // Same disposable-session admission used by normal native-tool E2E fixtures.
  await api(`/sessions/${id}/permissions/mode`, { mode: 'auto_approve' }, 'PUT');
  await api(`/sessions/${id}/presentation`, { title, pinned: false, expected_version: 0 }, 'PUT');
  return id;
};
const idle = async (id) => { for (let attempt = 0; attempt < 300; attempt++) { const state = await api(`/sessions/${id}`, undefined, 'GET'); if (!state.active_run) return state; await new Promise((resolve) => setTimeout(resolve, 100)); } throw Error(`Session ${id} did not settle`); };
const main = await makeSession('Review customer insights');
const calls = [['find-components', 'glob', { pattern: 'src/**/*.tsx' }], ['read-component', 'read', { path: longPath }], ['edit-component', 'edit', { path: longPath, expected_revision: 'sha256:' + createHash('sha256').update(body).digest('hex'), edits: [{ old_text: "const title = 'Customer insights';", new_text: "const title = 'Conversation insights';" }] }], ['read-docs', 'read', { path: 'README.md' }]];
for (const [index, [id, name, args]] of calls.entries()) provider.enqueue(id, index ? { functionOutputCallId: calls[index - 1][0] } : { token: 'REFRESH_MAIN' }, { kind: 'function_call', name, callId: id, arguments: args, stream: 'request' });
provider.enqueue('main-answer', { functionOutputCallId: 'read-docs' }, { kind: 'text', stream: 'request', text: 'Updated the conversation summary heading to **Conversation insights**.\n\nThe panel keeps its accessible section label, readable description, and primary action.\n\n### What changed\n- Renamed the heading in `ConversationSummaryPanel.tsx`.\n- Preserved the existing layout and button.\n\nReady for visual review on desktop and mobile.' });
await api(`/sessions/${main}/runs`, { prompt: 'REFRESH_MAIN\nInspect the customer insights component, rename its heading to Conversation insights, and summarize the change.' });
await idle(main);
const launchFailure = await makeSession('Review a failed child launch');
provider.enqueue('failed-launch', { token: 'REFRESH_FAILED_LAUNCH' }, { kind: 'function_call', name: 'subagent', callId: 'failed-launch', arguments: { profile: 'unknown-profile-for-screenshot', description: 'Audit customer insights', prompt: 'Review the component', background: false }, stream: 'request' });
provider.enqueue('failed-answer', { functionOutputCallId: 'failed-launch' }, { kind: 'text', stream: 'request', text: 'The child launch was rejected because the requested profile does not exist. No child session was created.' });
await api(`/sessions/${launchFailure}/runs`, { prompt: 'REFRESH_FAILED_LAUNCH\nTry the unavailable profile and report the validation result.' });
await idle(launchFailure);
const delegated = await makeSession('Review delegated completion');
provider.enqueue('completion-launch', { token: 'REFRESH_DELEGATED' }, { kind: 'function_call', name: 'subagent', callId: 'completion-launch', arguments: { profile: 'general', description: 'Check conversation accessibility', prompt: 'REFRESH_CHILD_REVIEW check the heading and primary action', child_session_id: null, background: false }, stream: 'request' });
provider.enqueue('completion-child', { token: 'REFRESH_CHILD_REVIEW', forbiddenTools: ['subagent'] }, { kind: 'text', text: 'The heading and primary action remain accessible. No additional code changes were necessary.', stream: 'request' });
provider.enqueue('completion-parent', { functionOutputCallId: 'completion-launch' }, { kind: 'text', text: 'The coding-agent review completed. No further changes were necessary.', stream: 'request' });
await api(`/sessions/${delegated}/runs`, { prompt: 'REFRESH_DELEGATED\nAsk a coding agent to review the heading and primary action.' });
await idle(delegated);
provider.enqueue('background-child', { token: 'REFRESH_BACKGROUND_REVIEW' }, { kind: 'text', text: 'Background accessibility review completed. The heading and primary action remain readable.', stream: 'request' });
provider.enqueue('background-parent', { token: 'Background accessibility review', afterStep: 'background-child', requiredTools: ['subagent'] }, { kind: 'text', text: 'Background review receipt acknowledged.', stream: 'request' });
const expectedRequests = provider.requests.length + 2;
await api(`/sessions/${delegated}/children`, { profile: 'general', description: 'Background accessibility review', prompt: 'REFRESH_BACKGROUND_REVIEW inspect the heading and action', background: true });
await provider.waitForRequestCount(expectedRequests, 15000);
await idle(delegated);

// Real Git states for the backend-only projection layer.
git(['checkout', '-b', 'incoming']); await fs.writeFile(path.join(workspace, 'review-checklist.md'), 'Incoming review checklist\n'); git(['add', 'review-checklist.md']); git(['commit', '-m', 'Incoming checklist']);
git(['checkout', 'main']); await fs.writeFile(path.join(workspace, 'review-checklist.md'), 'Main review checklist\n'); git(['add', 'review-checklist.md']); git(['commit', '-m', 'Main checklist']); git(['merge', 'incoming'], true);
await fs.unlink(path.join(workspace, 'README.md')); await fs.symlink('review-checklist.md', path.join(workspace, 'README.md'));
const stream = await makeSession('Review conversation summary');
const gate = new ScriptGate();
provider.enqueue('stream-answer', { token: 'REFRESH_STREAM' }, { kind: 'text', text: 'The conversation summary is easy to scan. Checking the heading and primary action.', stream: 'request' }, gate);
await api(`/sessions/${stream}/runs`, { prompt: 'REFRESH_STREAM\nCheck the conversation summary heading and primary action on desktop and mobile.' });
await gate.accepted;
provider.assertConsumed();
const metadata = { pid: process.pid, backendPid: server.pid, backend: base, backendSha: options.sha, buildBanner, binary: options.binary, projectId: project.project_id, provider: provider.baseUrl, sessions: { main, launchFailure, stream, delegated }, workspace, longPath, gitStatus: git(['status', '--porcelain']).stdout, note: 'Deterministic local provider driving real native glob/read/edit/read and a genuine failed launch. No app API interception; session IDs and native durations are factual.' };
await fs.writeFile(path.join(root, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata));
const control = http.createServer(async (request, response) => { if (request.url === '/finish') { gate.release(); response.end('Released'); } else if (request.url === '/requests') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(provider.requests)); } else response.end('Screenshot fixture'); });
await new Promise((resolve) => control.listen(options.controlPort ?? options.port + 20, '127.0.0.1', resolve));
const stop = async () => { gate.release(); await provider.stop(); try { process.kill(-server.pid, 'SIGTERM'); } catch {} control.close(); await log.close(); process.exit(0); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
