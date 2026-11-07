// Verbatim smoke probe against modeled DOM, not native/process acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../crates/nac-server/web/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const swift = fs.readFileSync(new URL('WorkspaceJourneys.swift', import.meta.url), 'utf8');
const script = swift.match(/static let disabledMcpFixtureScript = #"""\n([\s\S]*?)\n    """#/)[1];
// McpServerForm Name field -> InputWrapper -> input-wrapper -> UIInput.
// Keep both atom wrappers: a fixed two-parent lookup cannot reach Enabled.
const form = `<div><div><div><div class="label-small">Name*</div></div><div class="flex text-left flex-col gap-1"><div class="input-wrapper relative w-full h-fit"><input placeholder="my_server" value="wk_disabled_fixture"></div></div></div>
  <div><div><div><div class="label-small">Enabled</div></div><button id="enabled" aria-label="Enabled" role="switch" aria-checked="true"></button>
  <div><div class="label-small">Required</div></div><button id="required" aria-label="Required" role="switch" aria-checked="true"></button></div></div></div>`;
const dialog = body => `<div role="dialog" aria-label="MCP servers" data-modal-open="true">${body}</div>`;

function fixture(html = dialog(form)) {
  const dom = new JSDOM('<style>*{opacity:1;visibility:visible}</style>' + html, { runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(0, 0, this.hasAttribute('data-zero') ? 0 : 100, 20);
  };
  const clicks = [];
  for (const control of dom.window.document.querySelectorAll('[role=switch]')) {
    control.onclick = () => { clicks.push(control.id); control.setAttribute('aria-checked', control.getAttribute('aria-checked') === 'true' ? 'false' : 'true'); };
  }
  return { document: dom.window.document, clicks, probe: disable => dom.window.Function('disable', script)(disable), close: () => dom.window.close() };
}

test('only the owned Enabled switch changes despite unrelated/inert checked switches', () => {
  const f = fixture('<button id="outside" role="switch" aria-checked="true"></button><div inert><button id="inert" role="switch" aria-checked="true"></button></div>' + dialog(form));
  try {
    assert.equal(f.probe(false), false);
    assert.deepEqual(f.clicks, []);
    assert.equal(f.probe(true), true);
    assert.equal(f.probe(false), true);
    assert.equal(f.probe(true), true, 'already disabled is idempotent');
    assert.deepEqual(f.clicks, ['enabled']);
    for (const id of ['outside', 'inert', 'required']) assert.equal(f.document.getElementById(id).getAttribute('aria-checked'), 'true');
  } finally { f.close(); }
});

for (const [name, html] of [
  ['wrong fixture', dialog(form.replace('wk_disabled_fixture', 'other'))],
  ['two owned forms', dialog(form + form)],
  ['two active dialogs', dialog(form) + dialog(form)],
  ['inactive dialog', dialog(form).replace('data-modal-open="true"', '')],
  ['hidden dialog', dialog(form).replace('role="dialog"', 'hidden role="dialog"')],
  ['inert control', dialog(form.replace('id="enabled"', 'id="enabled" inert'))],
  ['hidden control', dialog(form.replace('id="enabled"', 'id="enabled" aria-hidden="true"'))],
  ['disabled control', dialog(form.replace('id="enabled"', 'id="enabled" disabled'))],
  ['aria-disabled control', dialog(form.replace('id="enabled"', 'id="enabled" aria-disabled="true"'))],
  ['zero-sized control', dialog(form.replace('id="enabled"', 'id="enabled" data-zero'))],
  ['faded control', dialog(form.replace('id="enabled"', 'id="enabled" style="opacity:0.5"'))],
  ['missing Enabled label', dialog(form.replace('>Enabled<', '>Other<'))],
  ['duplicate Enabled label', dialog(form.replace('>Required<', '>Enabled<'))],
  ['missing switch state', dialog(form.replace('id="enabled" aria-label="Enabled" role="switch" aria-checked="true"', 'id="enabled" aria-label="Enabled" role="switch"'))],
]) {
  test(name + ' fails closed before any click', () => {
    const f = fixture(html);
    try { assert.throws(() => f.probe(true)); assert.deepEqual(f.clicks, []); } finally { f.close(); }
  });
}

test('an ignored click cannot satisfy the disabled readback', () => {
  const f = fixture();
  try {
    f.document.getElementById('enabled').onclick = () => {};
    assert.equal(f.probe(true), false);
    assert.equal(f.probe(false), false);
  } finally { f.close(); }
});

// Modal uses a 150ms fade. The maintained waitJS may probe repeatedly; it
// must not click until the exact owned surface is visible, or re-enable it.
test('opening modal waits for full visibility before its one idempotent disable', () => {
  const f = fixture(dialog(form));
  try {
    const modal = f.document.querySelector('[role=dialog]');
    modal.style.opacity = '0.5';
    assert.throws(() => f.probe(true));
    assert.deepEqual(f.clicks, []);
    modal.style.opacity = '1';
    assert.equal(f.probe(true), true);
    assert.equal(f.probe(true), true);
    assert.equal(f.probe(false), true);
    assert.deepEqual(f.clicks, ['enabled']);
  } finally { f.close(); }
});

// Current production form uses a descriptive label span and a separate 44px
// target wrapper around the semantically named switch.
const currentForm = `<div><input placeholder="my_server" value="wk_disabled_fixture"></div>
<label><span><span class="label-small">Enabled</span><span>Disabled servers are kept</span></span>
<span class="flex min-h-11 min-w-11"><button id="enabled" aria-label="Enabled" role="switch" aria-checked="true"></button></span></label>
<label><span><span class="label-small">Required</span></span><span><button id="required" aria-label="Required" role="switch" aria-checked="true"></button></span></label>`;
test('current production target wrappers preserve exact owned switch admission', () => {
  const f=fixture(dialog(currentForm));
  try { assert.equal(f.probe(true),true); assert.equal(f.probe(false),true); assert.deepEqual(f.clicks,['enabled']); }
  finally { f.close(); }
});
for (const [name,html] of [
  ['missing semantic Enabled name',currentForm.replace('aria-label="Enabled"','aria-label="Other"')],
  ['duplicate semantic Enabled control',currentForm.replace('aria-label="Required"','aria-label="Enabled"')],
]) test(name+' refuses before any switch click',()=>{
  const f=fixture(dialog(html));try { assert.throws(()=>f.probe(true));assert.deepEqual(f.clicks,[]); }finally{f.close();}
});
