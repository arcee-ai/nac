// Actual capture script with modeled DOM/geometry; no native paint claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../crates/nac-server/web/package.json', import.meta.url));
const {JSDOM} = require('jsdom');
const swift = fs.readFileSync(new URL('WorkspaceSmoke.swift', import.meta.url), 'utf8');
const script = swift.match(/static let captureReadinessScript = #"""\n([\s\S]*?)\n    """#/)[1];
const expected = {kind:'file', id:'session', path:'workspace.ts', content:'export const workspaceFileFixture = 351;\n'};
const state = {path:expected.path, content:expected.content, binary:false, too_large:false};
const composer = '<textarea role="combobox" aria-label="Message"></textarea>';
const row = '<button title="workspace.ts" aria-pressed="true">workspace.ts</button>';
const header = '<div class="header-sm"><span title="workspace.ts">workspace.ts</span></div>';
const code = '<div><span>1</span><span class="code">export const workspaceFileFixture = 351;</span></div>';
const pane = header + '<div class="overflow-auto">' + code + '</div>';
function fixture(html = row + pane, hash = '#/session/session/files', chat = '') {
  const dom = new JSDOM('<style>*{opacity:1;visibility:visible}.overflow-auto{overflow:auto}</style>' + composer + '<section>' + chat + '</section><div id=panel><div id=detail>' + html + '</div></div>', {
    url:'http://127.0.0.1:351/' + hash, runScripts:'outside-only', pretendToBeVisual:true,
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(Number(this.closest('[data-left]')?.dataset.left || 0),
      Number(this.closest('[data-top]')?.dataset.top || 0), this.closest('[data-zero]') ? 0 : 100, 24);
  };
  let hitOwner;
  dom.window.HTMLElement.prototype.getClientRects = function () {
    hitOwner = this;
    return [this.getBoundingClientRect()];
  };
  // JSDOM has no glyph layout. Model text rectangles independently from
  // flexible element padding; real multiline geometry has separate Chromium
  // controls and native acceptance must still inspect the actual WK image.
  dom.window.Range.prototype.getClientRects = function () {
    hitOwner = this.startContainer.nodeType === dom.window.Node.TEXT_NODE
      ? this.startContainer.parentElement : this.startContainer;
    const rect = hitOwner.getBoundingClientRect();
    const text = new dom.window.DOMRect(rect.x, rect.y, hitOwner.hasAttribute('data-padding-covered') ? 80 : rect.width, rect.height);
    if (hitOwner.hasAttribute('data-no-text-fragments')) return [];
    if (hitOwner.hasAttribute('data-newline-fragment')) return [new dom.window.DOMRect(rect.x, rect.y, 0, rect.height), text];
    return [text];
  };
  dom.window.document.elementFromPoint = x =>
    hitOwner?.matches('[data-covered]') || (hitOwner?.matches('[data-padding-covered]') && x > 80)
      ? dom.window.document.body : hitOwner;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {
    get() { return Number(this.dataset.clipWidth || 100); },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', {
    get() { return Number(this.dataset.clipHeight || 24); },
  });
  return {window:dom.window, probe:(api=state) =>
    dom.window.Function('expected','fileState',script)(expected,api), close:() => dom.window.close()};
}
function check(html, api=state, hash) {
  const f = fixture(html, hash);
  try { return f.probe(api); } finally { f.close(); }
}
test('plain and untracked diff panes bind the selected file API and visible highlighted line', () => {
  for (const content of [code,
    '<div><div><span>@@</span><span class="code">@@ -0,0 +1 @@</span></div>' + code + '</div>']) {
    const result = check(row + header + '<div class="overflow-auto">' + content + '</div>');
    assert.equal(result.ready,true); assert.equal(result.file_api_bound,true);
    assert.equal(result.detail_count,1);
  }
});
test('chat markers and generic body text cannot replace the selected file pane', () => {
  const chat = '<div class="overflow-auto"><p>WK_RICH_COMPLETE</p><p>' + expected.content + '</p></div>';
  for (const html of [chat, row + chat, row + header + chat,
    row + pane.replace('class="overflow-auto"','class="overflow-auto" data-zero') + chat]) {
    assert.equal(check(html).ready,false);
  }
});
test('wrong route, file selection or detail identity fails even with matching content', () => {
  for (const hash of ['#/session/other/files','#/session/session/insights','#/session/session/files/extra'])
    assert.equal(check(row + pane,state,hash).ready,false);
  for (const html of [pane,row.replace('aria-pressed="true"','aria-pressed="false"') + pane,
    row + pane.replace('title="workspace.ts"','title="other.ts"'),row + pane + pane,
    row + pane.replace('= 351','= 352'),row + '<div inert>' + pane + '</div>',
    row + pane.replace('class="overflow-auto"','class="overflow-auto" style="opacity:0"'),
    row + pane.replace(code,'Loading file…' + code)]) assert.equal(check(html).ready,false);
});
test('stale, missing, binary, oversized or foreign API content cannot qualify', () => {
  for (const api of [null,{}, {...state,path:'other.ts'},{...state,content:'old'},
    {...state,binary:true},{...state,too_large:true}]) assert.equal(check(row + pane,api).ready,false);
});
test('the recheck detects file/pane replacement after an initially ready observation', () => {
  const f = fixture();
  try {
    assert.equal(f.probe().ready,true);
    assert.equal(f.probe({...state,content:'changed'}).ready,false);
    f.window.document.querySelector('span.code').textContent = 'changed';
    assert.equal(f.probe().ready,false);
  } finally { f.close(); }
});
test('offscreen code/header and overflow clipping cannot qualify a file image', () => {
  for (const html of [
    row + pane.replace('span class="code"','span class="code" data-left="2000"'),
    row + pane.replace('span class="code"','span class="code" data-top="2000"'),
    row + pane.replace('span title="workspace.ts"','span title="workspace.ts" data-left="2000"'),
    row + pane.replace('class="overflow-auto"','class="overflow-auto" data-clip-height="10"'),
    row + '<div style="overflow:hidden" data-clip-width="50">' + pane + '</div>',
  ]) assert.equal(check(html).ready,false);
});

test('chat snapshot selection is outside the owning Files panel', () => {
  const f = fixture(row + pane, '#/session/session/files', row);
  try { const result=f.probe(); assert.equal(result.ready,true); assert.equal(result.selected_count,1); }
  finally { f.close(); }
  const foreign = fixture(pane, '#/session/session/files', row);
  try { assert.equal(foreign.probe().ready,false); } finally { foreign.close(); }
});

test('file header and code must be unobscured, including noninteractive notifications', () => {
  for (const html of [row + pane.replace('class="code"', 'class="code" data-covered'),
    row + pane.replace('span title="workspace.ts"', 'span title="workspace.ts" data-covered')])
    assert.equal(check(html).ready,false);
  for (const style of ['', 'opacity:0.5', 'pointer-events:none']) {
    const f = fixture(row + pane, '#/session/session/files', '<div class="nac-toast" style="' + style + '">Saved</div>');
    try {
      assert.equal(f.probe().ready,false);
      f.window.document.querySelector('.nac-toast').remove();
      assert.equal(f.probe().ready,true);
    } finally { f.close(); }
  }
  for (const toast of ['<div class="nac-toast" data-left="2000">Elsewhere</div>',
    '<div class="nac-toast" style="display:none">Hidden</div>',
    '<div class="nac-toast" style="opacity:0">Transparent</div>']) {
    const f = fixture(row + pane, '#/session/session/files', toast);
    try { assert.equal(f.probe().ready,true); } finally { f.close(); }
  }
  const unknown = fixture();
  try {
    unknown.window.document.elementFromPoint = undefined;
    assert.equal(unknown.probe().ready,false);
  } finally { unknown.close(); }
});

test('flexible element padding is not rendered file text', () => {
  assert.equal(check(row + pane.replace('class="code"', 'class="code" data-padding-covered')).ready, true);
  assert.equal(check(row + pane.replace('class="code"', 'class="code" data-covered')).ready, false);
});
test('zero-width newline fragments do not hide nonempty rendered text', () => {
  assert.equal(check(row + pane.replace('class="code"', 'class="code" data-newline-fragment')).ready, true);
});
test('no rendered text fragments cannot qualify a matching code span', () => {
  assert.equal(check(row + pane.replace('class="code"', 'class="code" data-no-text-fragments')).ready, false);
});


// Preselection uses the actual journey expressions; modeled DOM is not WK evidence.
const journeys = fs.readFileSync(process.env.NAC_WORKSPACE_JOURNEYS_SOURCE ||
  new URL('WorkspaceJourneys.swift', import.meta.url), 'utf8');
const rowExpression = journeys.match(/let fileRow = """\n([\s\S]*?)\n            """/);
const gitBlock = journeys.slice(journeys.indexOf('        await check("git") {'), journeys.indexOf('        await check("approvals") {'));
const gitRowExpression = gitBlock.match(/let gitRow = """\n([\s\S]*?)\n            """/);
const gitDiffExpression = gitBlock.match(/let gitDiff = """\n([\s\S]*?)\n            """/);
const oldRowAction = journeys.match(/self\.js\("(const e=\[\.\.\.document\.querySelectorAll\('button'\)\][^\n]+?)"\)/);
function rowFixture({route = '#/session/owned-session/files', extra = '', row = '', git = false} = {}) {
  const mode = git ? 'Diff of changed files' : 'All files';
  const dom = new JSDOM('<style>*{opacity:1;visibility:visible}</style><div id=list>' +
    '<button aria-label="' + mode + '" aria-pressed="true">' + mode + '</button><div id=rows>' + row +
    '</div><div role=separator aria-label="Resize list panel"></div></div>' + extra,
    {url:'http://127.0.0.1:351/' + route, runScripts:'outside-only'});
  const {window} = dom;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new window.DOMRect(0,0,this.hasAttribute('data-zero') ? 0 : 100,24);
  };
  window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  let clicks = 0;
  window.document.addEventListener('click', event => {
    if (event.target.matches('button[title="workspace.ts"]')) clicks++;
  });
  const lookup = (git ? gitRowExpression : rowExpression)?.[1].replace('\\(self.quote(self.sessionID))', JSON.stringify('owned-session'));
  const source = fragment => {
    if (!rowExpression) return oldRowAction[1];
    const expression = (git ? gitBlock : journeys).match(fragment)[1];
    return expression.replace(git ? '\\(gitRow)' : '\\(fileRow)', lookup);
  };
  return {window, dom,
    ready:() => window.Function(source(git ? /self\.waitJS\("owned Git workspace\.ts row", "([^\n]+)"\)/ : /self\.waitJS\("owned Files workspace\.ts row", "([^\n]+)"\)/))(),
    act:() => window.Function(source(/self\.js\("(const rows=\(\(\) => \{ [^\n]+)"\)/))(),
    count:() => clicks, mount:html => window.document.querySelector('#rows').innerHTML = html,
    close:() => window.close()};
}
const ownedRow = '<button title="workspace.ts">workspace.ts</button>';
test('actual Files admission waits through delayed row mount and clicks only once', () => {
  const f = rowFixture();
  try {
    for (let poll = 0; poll < 4; poll++) {
      assert.equal(f.ready(), false); assert.equal(f.count(), 0);
    }
    f.mount(ownedRow);
    for (let poll = 0; poll < 4; poll++) assert.equal(f.ready(), true);
    assert.equal(f.count(), 0);
    assert.equal(f.act(), true); assert.equal(f.count(), 1);
    assert.equal(f.ready(), true); assert.equal(f.count(), 1);
  } finally { f.close(); }
});
test('actual Files admission rejects missing, foreign, ambiguous and unusable rows', () => {
  const cases = [
    {}, {extra:ownedRow}, {row:'<button title="folder/workspace.ts">workspace.ts</button>'},
    {row:'<button title="workspace.ts.old">workspace.ts</button>'},
    {row:'<button>workspace.ts</button>'}, {row:ownedRow + ownedRow},
    {row:ownedRow.replace('<button','<button disabled')},
    {row:'<div inert>' + ownedRow + '</div>'},
    {row:ownedRow.replace('<button','<button hidden')},
    {row:ownedRow.replace('<button','<button data-zero')},
    {row:ownedRow.replace('<button','<button style="opacity:0"')},
    {row:ownedRow.replace('<button','<button style="visibility:hidden"')},
    {row:ownedRow,route:'#/session/foreign/files'},
    {row:ownedRow,route:'#/session/owned-session/insights'},
    {row:ownedRow,extra:'<div><button aria-label="All files" aria-pressed="true"></button>' + ownedRow +
      '<div role=separator aria-label="Resize list panel"></div></div>'},
  ];
  for (const data of cases) {
    const f = rowFixture(data);
    try { assert.equal(f.ready(),false); assert.throws(() => f.act()); assert.equal(f.count(),0); }
    finally { f.close(); }
  }
  for (const change of [
    f => f.window.document.querySelector('[aria-label="All files"]').remove(),
    f => f.window.document.querySelector('[aria-label="All files"]').setAttribute('aria-pressed','false'),
    f => f.window.document.querySelector('[role=separator]').remove(),
  ]) {
    const f = rowFixture({row:ownedRow});
    try { change(f); assert.equal(f.ready(),false); assert.throws(() => f.act()); assert.equal(f.count(),0); }
    finally { f.close(); }
  }
});
test('actual Files action rechecks readiness without click retry', () => {
  for (const change of [
    f => f.mount(''),
    f => f.window.location.hash = '#/session/foreign/files',
    f => f.window.document.querySelector('#list').setAttribute('inert',''),
    f => f.mount(ownedRow + ownedRow),
  ]) {
    const f = rowFixture({row:ownedRow});
    try {
      assert.equal(f.ready(),true); change(f);
      assert.throws(() => f.act()); assert.equal(f.count(),0);
    } finally { f.close(); }
  }
});


const hunk = '<div><span>@@</span><span class="code">-0,0 +1,1</span></div>';
function gitFixture(html = header + '<div class="overflow-auto">' + hunk + code + '</div>', hash = '#/session/session/files', chat = '') {
  const f = fixture(html,hash,chat);
  f.window.document.querySelector('#panel').insertAdjacentHTML('beforeend',
    '<div id=list><button aria-label="Diff of changed files" aria-pressed="true"></button>' + row +
    '<div role=separator aria-label="Resize list panel"></div></div>');
  Object.defineProperty(f.window.document.body,'innerText',{get() { return this.textContent; }});
  const actual = gitDiffExpression?.[1].replace('\\(self.quote(self.sessionID))', JSON.stringify('session')) ||
    gitBlock.match(/self\.waitJS\("rendered Git diff", "([^\n]+)"\)/)[1];
  return {...f, git:() => f.window.Function(actual)(),
    qualifies:(api=state) => f.window.Function(actual)() && f.probe(api).ready && f.window.Function(actual)()};
}
test('actual Git evidence rejects chat hunk while legitimate plain Files capture remains ready', () => {
  const f = gitFixture(pane, '#/session/session/files', '<p>@@ unrelated transcript</p>');
  try { assert.equal(f.probe().ready,true); assert.equal(f.git(),false); assert.equal(f.qualifies(),false); }
  finally { f.close(); }
});
test('actual Git row admission is read-only and rechecked in explicit Diff mode', () => {
  const f = rowFixture({git:true});
  try {
    for (let n=0;n<4;n++) { assert.equal(f.ready(),false); assert.equal(f.count(),0); }
    f.mount(ownedRow); assert.equal(f.ready(),true); assert.equal(f.count(),0);
    f.act(); assert.equal(f.count(),1); assert.equal(f.ready(),true); assert.equal(f.count(),1);
    f.window.document.querySelector('[aria-label="Diff of changed files"]').setAttribute('aria-pressed','false');
    assert.equal(f.ready(),false); assert.throws(() => f.act()); assert.equal(f.count(),1);
  } finally { f.close(); }
  for (const data of [
    {}, {extra:ownedRow}, {row:ownedRow+ownedRow},
    {row:'<button title="folder/workspace.ts">workspace.ts</button>'},
    {row:ownedRow.replace('<button','<button disabled')},
    {row:'<div inert>'+ownedRow+'</div>'}, {row:ownedRow.replace('<button','<button hidden')},
    {row:ownedRow.replace('<button','<button data-zero')},
    {row:ownedRow,route:'#/session/foreign/files'},
    {row:ownedRow,extra:'<div><button aria-label="Diff of changed files" aria-pressed="true"></button>'+ownedRow+
      '<div role=separator aria-label="Resize list panel"></div></div>'},
  ]) {
    const g = rowFixture({...data,git:true});
    try { assert.equal(g.ready(),false); assert.throws(() => g.act()); assert.equal(g.count(),0); }
    finally { g.close(); }
  }
  const stale = rowFixture({git:true,row:ownedRow});
  try { assert.equal(stale.ready(),true); stale.mount(''); assert.throws(() => stale.act()); assert.equal(stale.count(),0); }
  finally { stale.close(); }
});
test('actual Git hunk and exact file source must share one selected visible owned pane', () => {
  const good = gitFixture();
  try { assert.equal(good.git(),true); assert.equal(good.qualifies(),true); }
  finally { good.close(); }
  const allFilesDiff = gitFixture();
  try {
    allFilesDiff.window.document.querySelector('#list [aria-label]').setAttribute('aria-label','All files');
    assert.equal(allFilesDiff.probe().ready,true); // An untracked file can show DiffPane in All files.
    assert.equal(allFilesDiff.git(),false); // Git independently admits its explicit changed-files mode.
  } finally { allFilesDiff.close(); }
  for (const html of [
    pane, pane.replace('workspaceFileFixture','wrongFixture'),
    header+'<div class="overflow-auto">'+hunk+'</div>',
    header+'<div class="overflow-auto">'+code+'</div><section>'+hunk+'</section>',
    header.replace('title="workspace.ts"','title="foreign.ts"')+'<div class="overflow-auto">'+hunk+code+'</div>',
    header+'<div class="overflow-auto">'+hunk.replace('<span>','<span hidden>')+code+'</div>',
    header+'<div class="overflow-auto">'+hunk.replace('<span>','<span inert>')+code+'</div>',
    header+'<div class="overflow-auto">'+hunk.replace('<span>','<span data-covered>')+code+'</div>',
    header+'<div class="overflow-auto">'+hunk.replace('<span>','<span data-top="-30">')+code+'</div>',
    header+'<div class="overflow-auto" data-clip-width="20">'+hunk+code+'</div>',
    header+'<div class="overflow-auto">'+hunk.replace('-0,0 +1,1','not a hunk')+code+'</div>',
    header+'<div class="overflow-auto">'+hunk+code+'</div>'+header+'<div class="overflow-auto">'+hunk+code+'</div>',
  ]) {
    const f=gitFixture(html,'#/session/session/files','<p>@@ elsewhere '+expected.content+'</p>');
    try { assert.equal(f.qualifies(),false); }
    finally { f.close(); }
  }
  for (const change of [
    f => f.window.location.hash='#/session/foreign/files',
    f => f.window.document.querySelector('#list [title]').setAttribute('aria-pressed','false'),
    f => f.window.document.querySelector('#list [title]').setAttribute('title','foreign.ts'),
    f => f.window.document.querySelector('#list [aria-label]').setAttribute('aria-pressed','false'),
    f => f.window.document.querySelector('#list').insertAdjacentHTML('beforeend',row),
    f => f.window.document.querySelector('#detail').insertAdjacentHTML('beforeend','<div class="nac-toast" style="pointer-events:none">Covered</div>'),
  ]) {
    const f=gitFixture();
    try { assert.equal(f.qualifies(),true); change(f); assert.equal(f.qualifies(),false); }
    finally { f.close(); }
  }
  for (const api of [null,{...state,path:'foreign.ts'},{...state,content:'stale'},{...state,binary:true},{...state,too_large:true}]) {
    const f=gitFixture();
    try { assert.equal(f.qualifies(api),false); } finally { f.close(); }
  }
});
