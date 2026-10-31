// Pure DOM contract checks, not WKWebView/physical-input qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../crates/nac-server/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const swift = fs.readFileSync(new URL('WorkspaceSmoke.swift', import.meta.url), 'utf8');
const script = swift.match(/static let captureReadinessScript = #"""\n([\s\S]*?)\n    """#/)[1];
const project = { kind: 'project', id: 'owned-project', text: 'Disposable Mac preview' };
const child = { kind: 'transcript', id: 'owned-child', text: 'Hello from the isolated NAC Mac preview.', readOnly: true, identityText: 'WK_CHILD' };
const card = '<div data-item-kind="project" data-item-id="owned-project">Disposable Mac preview</div>';
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
  return { window: dom.window, probe: (expected) => dom.window.Function('expected', script)(expected),
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
  assert.equal(observation(card.replace('owned-project', 'other-project'), project, '#/').ready, false);
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
