// Pure DOM contract checks, not WKWebView/physical-input qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { originalScript, originalScriptSHA256 } from './workspace/capture-readiness-24d.mjs';

const require = createRequire(new URL('../../crates/nac-server/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const swift = fs.readFileSync(new URL('WorkspaceSmoke.swift', import.meta.url), 'utf8');
const script = swift.match(/static let captureReadinessScript = #"""\n([\s\S]*?)\n    """#/)[1];
const project = { kind: 'project', id: 'owned-project', text: 'Disposable Mac preview' };
const child = { kind: 'transcript', id: 'owned-child', text: 'Hello from the isolated NAC Mac preview.', readOnly: true, identityText: 'WK_CHILD' };
// ProjectsListPage and ProjectCard both carry identity attributes. Only the
// inner role=button card and its rendered title establish visible content.
const card = '<div data-item-kind="project" data-item-id="owned-project"><div role="button" class="fade" data-item-kind="project" data-item-id="owned-project"><div class="project-title">Disposable Mac preview</div></div></div>';
const chrome = '<button aria-label="Fixture, parent chat">Parent</button>';
const message = '<div id="transcript" class="overflow-auto"><p>WK_CHILD</p><p>Hello from the isolated NAC Mac preview.</p></div>';
const loader = '<div role="status" aria-label="Loading conversation">Loading</div>';
const composer = '<textarea role="combobox" aria-label="Message"></textarea>';

function fixture(html, hash = '#/session/owned-child/insights') {
  const dom = new JSDOM('<style>*{opacity:1;visibility:visible}</style>' + html, {
    url: 'http://127.0.0.1:351/' + hash, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  // JSDOM has no layout. Modeled geometry exercises the zero-size branch;
  // it never represents a native pixel/painting observation.
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(0, 0, this.closest('[data-zero]') ? 0 : 100, 24);
  };
  return { window: dom.window, probe: (expected, permissionState = null, sessionState = null) => {
    const evaluate = body => dom.window.Function('expected', 'permissionState', 'sessionState', body)(expected, permissionState, sessionState);
    const before = dom.window.document.body.innerHTML;
    const original = evaluate(originalScript);
    const result = evaluate(script);
    const projection = { ...result };
    for (const key of ['approval_predicates', 'resource_predicates', 'settled_predicates', 'message_page']) delete projection[key];
    const plain = value => JSON.parse(JSON.stringify(value));
    // Deliberate contract delta: an explicit COMPLETE visible page is now
    // mandatory. All other frozen fields and all approval behavior stay exact.
    const page = sessionState?.message_page;
    const completePage = page?.start === 0 && page?.end === 2 && page?.total === 2 && page?.has_older === false;
    if (expected.kind === 'rich' && !completePage && original.reason !== 'requested route not current') {
      original.ready = false;
      original.reason = 'owned full answer not settled';
    }
    assert.deepEqual(plain(projection), plain(original), 'only the declared mandatory-page delta may change prior fields');
    assert.equal(dom.window.document.body.innerHTML, before, 'neither probe may mutate the document');
    return result;
  },
    close: () => dom.window.close() };
}

function observation(html, target = child, hash) {
  const f = fixture(html, hash);
  try { return f.probe(target); } finally { f.close(); }
}

test('actual owned project card on committed projects page is ready', () => {
  const result = observation(card, project, '#/');
  assert.equal(result.ready, true);
  assert.equal(result.expected.id, 'owned-project');
  assert.equal(result.geometry.width, 100);
});

test('recorded projects boundary: hash plus sidebar name cannot qualify the old session', () => {
  const f = fixture('<aside>Disposable Mac preview</aside>' + composer + loader, '#/');
  try {
    // Supply known visible sidebar text explicitly: JSDOM lacks innerText.
    Object.defineProperty(f.window.document.body, 'innerText', { value: 'Disposable Mac preview' });
    const formerWait = f.window.Function("return location.hash === '#/' && document.body.innerText.includes('Disposable Mac preview');");
    assert.equal(formerWait(), true);
    assert.equal(f.probe(project).ready, false);
  } finally { f.close(); }
});

test('project title with wrong owned identity is rejected', () => {
  assert.equal(observation(card.replaceAll('owned-project', 'other-project'), project, '#/').ready, false);
});

test('project identity wrapper without a mounted card is rejected', () => {
  const wrapper = '<div data-item-kind="project" data-item-id="owned-project">Disposable Mac preview</div>';
  assert.equal(observation(wrapper, project, '#/').ready, false);
});

for (const opacity of ['0', '0.5']) {
  test('nested animated project card at opacity ' + opacity + ' is rejected', () => {
    const hiddenCard = card.replace('role="button"', 'role="button" style="opacity:' + opacity + '"');
    assert.equal(observation(hiddenCard, project, '#/').ready, false);
  });
}

test('hidden project title inside a visible nested card is rejected', () => {
  const hiddenTitle = card.replace('class="project-title"', 'class="project-title" style="opacity:0"');
  assert.equal(observation(hiddenTitle, project, '#/').ready, false);
});

test('project card in wrong route is rejected', () => {
  assert.equal(observation(card, project).ready, false);
});

test('exact delegated target and visible completed message are ready', () => {
  const result = observation(chrome + message);
  assert.equal(result.ready, true);
  assert.equal(result.hash, '#/session/owned-child/insights');
  assert.match(result.content, /Hello from the isolated/);
});

test('recorded delegated boundary: read-only chrome cannot qualify loading transcript', () => {
  const f = fixture(chrome + loader + message);
  try {
    const formerWait = f.window.Function('return !document.querySelector(\'[role=combobox][aria-label=Message]\') && !!document.querySelector(\'button[aria-label$=", parent chat"]\');');
    assert.equal(formerWait(), true);
    assert.equal(f.probe(child).ready, false);
    assert.equal(f.probe(child).reason, 'conversation still loading');
  } finally { f.close(); }
});

test('message from wrong delegated route is rejected', () => {
  assert.equal(observation(chrome + message, child, '#/session/other-child/insights').ready, false);
  assert.equal(observation(chrome + message, child, '#/project/owned-child').ready, false);
});

test('matching URL and common answer cannot qualify another child transcript', () => {
  assert.equal(observation(chrome + message.replace('WK_CHILD', 'WK_MANAGED')).ready, false);
});

test('unique child title outside the transcript cannot supply identity', () => {
  assert.equal(observation(chrome + '<p>WK_CHILD</p>' + message.replace('WK_CHILD', 'WK_MANAGED')).ready, false);
});

test('header or button copy of expected message is not transcript content', () => {
  assert.equal(observation(chrome + '<header>' + child.text + '</header>').ready, false);
  assert.equal(observation(chrome + '<button>' + child.text + '</button>').ready, false);
});

test('read-only chrome without expected message is rejected', () => {
  assert.equal(observation(chrome).ready, false);
});

for (const [name, style] of [
  ['hidden content', 'visibility:hidden'], ['removed content', 'display:none'],
  ['transparent ancestor', 'opacity:0'], ['unfinished fade', 'opacity:0.5'],
]) {
  test(name + ' cannot qualify a capture', () => {
    assert.equal(observation(chrome + '<div style="' + style + '">' + message + '</div>').ready, false);
  });
}

test('zero-sized expected content is rejected', () => {
  assert.equal(observation(chrome + '<div data-zero>' + message + '</div>').ready, false);
});

test('hidden document is rejected even with mounted content', () => {
  const f = fixture(chrome + message);
  try {
    Object.defineProperty(f.window.document, 'visibilityState', { value: 'hidden' });
    assert.equal(f.probe(child).ready, false);
  } finally { f.close(); }
});

test('direct transcript requires its own composer', () => {
  const direct = { ...child, readOnly: false };
  assert.equal(observation(composer + message, direct).ready, true);
  assert.equal(observation(chrome + message, direct).ready, false);
});

test('probe waits for revealed content without modifying styles or loading flags', () => {
  const f = fixture(chrome + loader + '<div style="opacity:0">' + message + '</div>');
  try {
    assert.equal(f.probe(child).ready, false);
    assert.equal(f.window.document.querySelector('[aria-label="Loading conversation"]').textContent, 'Loading');
    f.window.document.querySelector('[aria-label="Loading conversation"]').remove();
    f.window.document.querySelector('#transcript').parentElement.style.opacity = '1';
    assert.equal(f.probe(child).ready, true);
  } finally { f.close(); }
});


// Approval observations read a modeled broker snapshot; no reply or live HTTP.
const approval = {kind:'approval',id:'owned-direct',requestID:'owned-request',text:'/private/owned-fixture/approval.txt'};
const pending = {requests:[{id:'owned-request',session_id:'owned-direct',tool:'read',call_id:'wk-approval',
  resources:[{action:'read',resource:approval.text,display:approval.text}]}]};
const approvalHTML = '<div data-nac-content inert>' + composer + message + '</div><div data-nac-overlays>' +
  '<div role="dialog" aria-labelledby="permission-title"><h2 id="permission-title">Permission required</h2>' +
  '<section aria-label="Pending permission requests"><button aria-pressed="true">this session (owned-direct): read</button></section>' +
  '<section aria-label="Requested access">Requested by this session (owned-direct). ' + approval.text + '</section>' +
  '<button id="allow-once">Allow once</button></div></div>';

function approvalObservation(html = approvalHTML, state = pending, hash = '#/session/owned-direct/insights') {
  const f = fixture(html, hash);
  try {
    const before = f.window.document.querySelector('[data-nac-content]').outerHTML;
    const result = f.probe(approval, state);
    assert.equal(f.window.document.querySelector('[data-nac-content]').outerHTML, before);
    assert.equal(f.window.document.querySelector('[data-nac-content]').inert ||
      f.window.document.querySelector('[data-nac-content]').hasAttribute('inert'), true);
    return result;
  } finally { f.close(); }
}

test('active owned approval dialog qualifies while background stays inert', () => {
  assert.equal(approvalObservation().ready, true);
});
for (const [name, field, value] of [
  ['wrong request','id','another-request'], ['wrong owner','session_id','another-session'],
  ['wrong call','call_id','another-call'],
]) {
  test(name + ' cannot qualify approval', () => {
    const state = structuredClone(pending); state.requests[0][field] = value;
    assert.equal(approvalObservation(approvalHTML, state).ready, false);
  });
}
test('wrong requested file cannot qualify approval', () => {
  const state = structuredClone(pending); state.requests[0].resources[0].resource = '/another/approval.txt';
  assert.equal(approvalObservation(approvalHTML, state).ready, false);
});
test('retired broker request cannot qualify stale visible controls', () => {
  assert.equal(approvalObservation(approvalHTML, {requests:[]}).ready, false);
});
test('wrong modal selection cannot qualify approval', () => {
  assert.equal(approvalObservation(approvalHTML.replaceAll('(owned-direct)', '(another-session)')).ready, false);
});
test('hidden modal or hidden Allow once cannot qualify approval', () => {
  assert.equal(approvalObservation(approvalHTML.replace('role="dialog"', 'role="dialog" style="opacity:0"')).ready, false);
  assert.equal(approvalObservation(approvalHTML.replace('id="allow-once"', 'id="allow-once" style="visibility:hidden"')).ready, false);
});
test('retired disabled controls cannot qualify approval', () => {
  assert.equal(approvalObservation(approvalHTML.replace('id="allow-once"', 'id="allow-once" disabled')).ready, false);
});
test('wrong current route cannot qualify approval', () => {
  assert.equal(approvalObservation(approvalHTML, pending, '#/session/another-session/insights').ready, false);
});

const richMarkdown = "WK_RICH_COMPLETE\n\n| Engine | Workspace |\n| --- | --- |\n| System WebKit | shared React |\n\nA formula: $x^2 + y^2 = z^2$.\n\n```typescript\nexport const webkitFixture = 351;\n```\n\n[Fixture source](workspace.ts) and [NAC documentation](https://github.com/arcee-ai/nac).";

const richTarget = {kind:'rich',id:'owned-rich',markdown:richMarkdown};
const richState = {message_page:{start:0,end:2,total:2,has_older:false},metadata:{session_id:'owned-rich'},messages:[{role:'user',content:'WK_RICH'},{role:'assistant',content:richMarkdown}],message_created_at:[null,'fixture-timestamp']};
const richHTML = '<div data-nac-content><div class="overflow-auto"><div class="markdown-content"><p>WK_RICH_COMPLETE</p><table><tr><th>Engine</th><th>Workspace</th></tr><tr><td>System WebKit</td><td>shared React</td></tr></table><p>A formula <mjx-container jax="CHTML"><mjx-math><mjx-mi><mjx-c>x</mjx-c></mjx-mi></mjx-math></mjx-container></p><pre><code><span style="color:teal">export const webkitFixture = 351;</span></code></pre></div></div></div>' + composer;
function richObservation(html=richHTML,state=richState,options={}) {
 const f=fixture(html,options.hash||'#/session/owned-rich/insights');
 try {
  Object.defineProperty(f.window.document,'fonts',{value:{status:options.fonts===false?'loading':'loaded',check:()=>options.fonts!==false}});
  f.window.performance.getEntriesByType=()=>options.resources===false?[]:[{name:'http://127.0.0.1/mathjax-fixture.woff'}];
  if(options.offscreen) f.window.HTMLElement.prototype.getBoundingClientRect=function(){return new f.window.DOMRect(1100,0,100,24);};
  if(options.clipped) {f.window.document.querySelector('.overflow-auto').style.overflowX='auto';f.window.HTMLElement.prototype.getBoundingClientRect=function(){return new f.window.DOMRect(this.classList.contains('overflow-auto')?20:0,0,100,24);};}
  const prior=f.window.document.body.innerHTML;
  const result=f.probe(richTarget,null,state);
  assert.equal(f.window.document.body.innerHTML,prior);
  return result;
 } finally {f.close();}
}
test('rich capture binds full settled owned answer to all actual rich targets',()=>{
 const r=richObservation();assert.equal(r.ready,true);assert.equal(r.full_answer,richMarkdown);assert.equal(r.message_identity.visible_index,1);assert.equal(r.surfaces.length,5);
});
for(const [name,html] of [
 ['marker only',richHTML.replace(/<table>[\s\S]*?<\/pre>/,'')],
 ['missing table',richHTML.replace(/<table>[\s\S]*?<\/table>/,'')],
 ['wrong table',richHTML.replace('shared React','another workspace')],
 ['missing code',richHTML.replace(/<pre>[\s\S]*?<\/pre>/,'')],
 ['wrong code',richHTML.replace('351;','352;')],
 ['unhighlighted code',richHTML.replace(' style="color:teal"','')],
 ['missing MathJax',richHTML.replace(/<mjx-container[\s\S]*?<\/mjx-container>/,'')],
 ['empty MathJax wrapper',richHTML.replace(/<mjx-math>[\s\S]*?<\/mjx-math>/,'')],
 ['hidden descendant',richHTML.replace('<table>','<table style="visibility:hidden">')],
 ['transparent ancestor',richHTML.replace('class="markdown-content"','class="markdown-content" style="opacity:0"')],
 ['unfinished fade',richHTML.replace('class="markdown-content"','class="markdown-content" style="opacity:0.5"')],
 ['aria hidden',richHTML.replace('data-nac-content','data-nac-content aria-hidden="true"')],
 ['inert background',richHTML.replace('data-nac-content','data-nac-content inert')],
 ['zero geometry',richHTML.replace('<table>','<table data-zero>')],
 ['loading',richHTML+loader],['error view',richHTML+'<div role="alert">failed</div>'],
 ['duplicate rich answer',richHTML+richHTML],
])test(name+' cannot qualify rich capture',()=>assert.equal(richObservation(html).ready,false));
for(const [name,mutate] of [
 ['wrong owner',s=>s.metadata.session_id='other'],['stale full answer',s=>s.messages[1].content+=' stale'],
 ['wrong prompt',s=>s.messages[0].content='other'],['active run',s=>s.active_run={generation:1}],
 ['active compaction',s=>s.active_compaction={}],['durable failure',s=>s.run_failure={}],
 ['extra transcript message',s=>s.messages.push(s.messages[1])],['paged old transcript',s=>s.message_page={start:2,total:4}],
])test(name+' cannot bind rich answer',()=>{const state=structuredClone(richState);mutate(state);assert.equal(richObservation(richHTML,state).ready,false);});
for(const [name,options] of [['fonts loading',{fonts:false}],['math font absent',{resources:false}],['offscreen',{offscreen:true}],['clipped',{clipped:true}],['wrong route',{hash:'#/session/other/insights'}]])test(name+' cannot qualify rich capture',()=>assert.equal(richObservation(richHTML,richState,options).ready,false));

test('the original comparator is the frozen 24d probe, not revised expectations', () => {
  assert.equal(createHash('sha256').update(originalScript).digest('hex'), originalScriptSHA256);
  assert.ok(originalScript.includes('messages.length === 2 && index === 1'));
});

test('rich diagnostics retain every settled conjunct without choosing readiness', () => {
  const result = richObservation();
  assert.equal(result.ready, true);
  assert.equal(result.settled_predicates.page_absent, false);
  for (const value of Object.values(result.settled_predicates)) assert.equal(typeof value, 'boolean');
  for (const key of ['owner', 'no_active_run', 'no_active_compaction', 'no_run_failure',
    'no_recovery_warning', 'message_count_2', 'answer_index_1', 'first_role_user',
    'first_content_WK_RICH', 'page_start_0', 'page_end_2', 'page_total_2', 'page_no_older', 'page_valid', 'settled']) {
    assert.equal(result.settled_predicates[key], true, key);
  }
});

for (const [key, change] of [
  ['owner', s => s.metadata.session_id = 'wrong'],
  ['no_active_run', s => s.active_run = {}],
  ['no_active_compaction', s => s.active_compaction = {}],
  ['no_run_failure', s => s.run_failure = {}],
  ['no_recovery_warning', s => s.transcript_recovery_warning = 'modeled warning'],
  ['message_count_2', s => s.messages.push({role:'tool',content:'modeled extra'})],
  ['answer_index_1', s => s.messages.unshift({role:'system',content:'modeled extra'})],
  ['first_role_user', s => s.messages[0].role = 'tool'],
  ['first_content_WK_RICH', s => s.messages[0].content = 'wrong'],
  ['page_valid', s => s.message_page = {start:1,total:2}],
  ['page_valid', s => s.message_page = {start:0,total:3}],
]) {
  test('diagnostics expose false ' + key + ' while the original rejection remains', () => {
    const state = structuredClone(richState); change(state);
    const result = richObservation(richHTML, state);
    assert.equal(result.ready, false);
    assert.equal(result.settled_predicates[key], false);
    assert.equal(result.settled_predicates.settled, false);
  });
}

for (const role of ['system','user','assistant','tool']) {
  test('hypothetical extra ' + role + ' reproduces 3/index2 but is never newly accepted', () => {
    const state = structuredClone(richState);
    state.messages.unshift({role,content:'modeled extra, not the unretained native message'});
    const result = richObservation(richHTML, state);
    assert.equal(result.ready, false);
    assert.equal(result.message_identity.message_count, 3);
    assert.equal(result.message_identity.visible_index, 2);
    assert.equal(result.settled_predicates.message_count_2, false);
    assert.equal(result.settled_predicates.answer_index_1, false);
  });
}

test('more messages than the diagnostic cap still reach the complete original guard', () => {
  const state = structuredClone(richState);
  state.messages = Array.from({length:31}, () => ({role:'tool',content:'modeled extra'})).concat(state.messages);
  const result = richObservation(richHTML, state);
  assert.equal(result.ready, false);
  assert.equal(result.message_identity.message_count, 33);
  assert.equal(result.message_identity.visible_index, 32);
});

test('approval diagnostics separately retain exact ownership and selected-modal predicates', () => {
  const result = approvalObservation();
  assert.equal(result.ready, true);
  for (const [key,value] of Object.entries(result.approval_predicates)) {
    assert.equal(value, true, key);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.resource_predicates)), [{action:true,resource:true,display:true}]);
});

for (const [field, key] of [['id','request_id'],['session_id','session_id'],['tool','tool'],['call_id','call_id']]) {
  test('approval diagnostics isolate wrong ' + field + ' without relaxing the original guard', () => {
    const state = structuredClone(pending); state.requests[0][field] = 'wrong';
    const result = approvalObservation(approvalHTML, state);
    assert.equal(result.ready, false);
    assert.equal(result.approval_predicates[key], false);
    assert.equal(result.approval_predicates.owned, false);
  });
}

for (const field of ['action','resource','display']) {
  test('approval diagnostics expose the separate ' + field + ' resource mismatch', () => {
    const state = structuredClone(pending); state.requests[0].resources[0][field] = 'wrong';
    const result = approvalObservation(approvalHTML, state);
    assert.equal(result.ready, false);
    assert.equal(result.resource_predicates[0][field], false);
    assert.equal(result.approval_predicates.exact_read_resource, false);
  });
}

test('path alias spelling remains an exact mismatch, not a canonicalization repair', () => {
  const f = fixture(approvalHTML, '#/session/owned-direct/insights');
  try {
    const result = f.probe({...approval,text:'/var/owned-fixture/approval.txt'}, pending);
    assert.equal(result.ready, false);
    assert.equal(result.resource_predicates[0].resource, false);
    assert.equal(result.resource_predicates[0].display, false);
    assert.equal(result.approval_predicates.access_path, false);
  } finally { f.close(); }
});

test('resource and display matches in different rows cannot satisfy ownership', () => {
  const state = structuredClone(pending);
  state.requests[0].resources = [
    {action:'read',resource:approval.text,display:'wrong'},
    {action:'read',resource:'wrong',display:approval.text},
  ];
  const result = approvalObservation(approvalHTML, state);
  assert.equal(result.ready, false);
  assert.equal(result.approval_predicates.exact_read_resource, false);
});

test('a matching ninth resource is still accepted by the unchanged full-input guard', () => {
  const state = structuredClone(pending), correct = state.requests[0].resources[0];
  state.requests[0].resources = Array.from({length:8}, () => ({action:'read',resource:'wrong',display:'wrong'})).concat([correct]);
  const result = approvalObservation(approvalHTML, state);
  assert.equal(result.ready, true);
  assert.equal(result.approval_predicates.exact_read_resource, true);
  assert.equal(result.resource_predicates.length, 8);
  assert.ok(result.resource_predicates.every(r => r.resource === false));
});

test('more pending requests than the diagnostic cap never become a singleton', () => {
  const state = {requests:Array.from({length:5}, () => structuredClone(pending.requests[0]))};
  const result = approvalObservation(approvalHTML, state);
  assert.equal(result.ready, false);
  assert.equal(result.approval_predicates.one_request, false);
});

// No fetches: explicit source-contract examples, not a native/server result.
for (const page of [null, {}, {start:0,total:2},
  {start:1,end:2,total:2,has_older:false}, {start:0,end:1,total:2,has_older:false},
  {start:0,end:2,total:3,has_older:false}, {start:0,end:2,total:2,has_older:true},
  {start:false,end:2,total:2,has_older:false}, {start:0,end:'2',total:2,has_older:false},
  {start:0,end:2,total:2,has_older:0}]) {
 test('explicit visible page must be complete and strictly typed: '+JSON.stringify(page),()=>{
  const state=structuredClone(richState);state.message_page=page;
  const result=richObservation(richHTML,state);
  assert.equal(result.ready,false);assert.equal(result.settled_predicates.page_valid,false);
 });
}
test('unfiltered modeled canonical history cannot satisfy the separate visible-page guard',()=>{
 const canonical=structuredClone(richState); delete canonical.message_page;
 canonical.messages.unshift({role:'system',content:'new offline synthetic System, no historical plaintext claim'});
 const original=structuredClone(canonical);
 assert.equal(richObservation(richHTML,canonical).ready,false);
 assert.equal(richObservation().ready,true);
 assert.deepEqual(canonical,original);
});

// Data probe controls only: no WKWebView, network or native acceptance.
const assetScript = swift.match(/static let assetEvidenceScript = #"""\n([\s\S]*?)\n    """#/)[1];
function assetSample(resources, errors, inter = true) {
  return Function('window', 'performance', 'document', 'location', assetScript)(
    { __previewEvidence: errors === null ? undefined : { errors } },
    { timeOrigin: 1, getEntriesByType: () => resources.map(name => ({ name })) },
    { fonts: { check: () => inter } }, { origin: 'http://127.0.0.1:351' });
}
const localAssets = ['http://127.0.0.1:351/mathjax-fixture.woff',
  ...['a','b','c'].map(x => 'http://127.0.0.1:351/assets/dist/assets/' + x + '.js')];
test('first-document error/nonlocal sample survives a clean new document', () => {
  const errors = ['first document script error'];
  const first = assetSample([...localAssets, 'https://outside.invalid/font.woff'], errors);
  errors.length = 0;
  const second = assetSample(localAssets, []);
  assert.equal(first.offline_ok, false);
  assert.deepEqual(first.errors, ['first document script error']);
  assert(first.resources.includes('https://outside.invalid/font.woff'));
  assert.equal(second.offline_ok, true);
  // Native aggregate must retain both observations; a last-document sample cannot replace first.
});
test('asset probe refuses missing observer and missing first-load fonts/chunks', () => {
  assert.equal(assetSample(localAssets, null).offline_ok, false);
  assert.equal(assetSample(localAssets.slice(0, 2), []).fonts_chunks_ok, false);
  assert.equal(assetSample(localAssets, [], false).fonts_chunks_ok, false);
});
