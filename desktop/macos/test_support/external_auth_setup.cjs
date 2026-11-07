const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const script = name => {
  const found = source.match(new RegExp(`static let ${name} = #"""([\\s\\S]*?)"""#`));
  assert(found, `missing actual fixture script ${name}`);
  return found[1];
};
const ready = new Function('expectedRoute', script('sessionReadyScript'));
let composer = true, dialog = false, width = 100;
global.location = {hash: '#/project/old'};
global.document = {querySelector(selector) {
  if (selector === '[role=combobox][aria-label=Message]')
    return composer ? {getBoundingClientRect: () => ({width, height: 20})} : null;
  if (selector === '[role=dialog]') return dialog ? {} : null;
  throw new Error('unexpected DOM query');
}};
assert.equal(ready(''), false, 'an old project document is not the created session');
location.hash = '#/session/created'; composer = false;
assert.equal(ready(''), false, 'session route without its composer is not ready');
composer = true; dialog = true;
assert.equal(ready(''), false, 'creation dialog teardown has not settled');
dialog = false; width = 0;
assert.equal(ready(''), false, 'hidden composer is not ready');
width = 100;
assert.equal(ready('#/session/other'), false, 'reload cannot select another session');
assert.equal(ready('#/session/created'), true);

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const calls = [];
const secret = 'inert-value-must-not-cross-native';
global.window = {};
global.fetch = async (path, options) => {
  calls.push({path, body: JSON.parse(options.body)});
  return {ok: true, json: async () => path === '/credentials' ?
    {name: 'opaque-fixture-name', value: secret} : {}};
};
(async () => {
  const fixture = 'http://127.0.0.1:19001';
  const name = await new AsyncFunction('fixture', script('seedScript'))(fixture);
  assert.equal(name, 'opaque-fixture-name');
  assert.equal(JSON.stringify(name).includes(secret), false);
  assert.equal('__externalAuthFixture' in window, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, '/mcp_library/servers');
  assert.equal(calls[1].body.enabled, false);
  // A real reload discards the old page globals. Configuration must continue
  // from explicit opaque fixture identity instead of resurrecting those globals.
  global.window = {};
  const configured = await new AsyncFunction('fixture', 'mode', 'credential',
    script('configureScript'))(fixture, 'hold', name);
  assert.equal(configured, true);
  assert.equal(calls[2].body.registration.client_id_credential, name);
  assert.equal(calls[2].body.authorization_metadata.authorization_endpoint,
    fixture + '/oauth/authorize/hold');
  assert.equal(JSON.stringify(calls).includes(secret), false);
  console.log('Actual session readiness, opaque seed return and fresh-page configuration controls passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

{
// Execute the production fixture predicate against isolated DOMs. These controls
// exercise the semantic paragraph status and reject unrelated or ambiguous UI;
// they do not stand in for the native document/actor custody checks.
const {createRequire} = require('node:module');
const path = require('node:path');
const {JSDOM} = createRequire(path.resolve(path.dirname(process.argv[2]),
  '../../crates/nac-server/web/package.json'))('jsdom');
const section=(state='Connected',extra='')=>`<section aria-labelledby="oauth-title"><h3 id="oauth-title">OAuth</h3><p role="status">${state}</p><button>Log out</button>${extra}</section>`;
const dialog=(body=section(),name='external-auth-fixture')=>`<div role="dialog" aria-label="MCP servers" data-modal-open="true"><input aria-label="Server name" value="${name}">${body}</div>`;
const evaluate=(html,value)=>{
 const dom=new JSDOM('<style>*{opacity:1;visibility:visible}</style>'+html,{runScripts:'outside-only'});
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return new dom.window.DOMRect(0,0,100,20);};
 try{return {old:dom.window.Function('value',"return [...document.querySelectorAll('span,div')].some(e=>e.textContent.trim()===value)")(value),actual:dom.window.Function('value', script('oauthStatusScript'))(value)};}finally{dom.window.close();}
};
const rows=[];
for(const value of ['Connected','Authorization failed','Waiting for authorization','Ready to connect']){
 const result=evaluate(dialog(section(value)),value);assert.equal(result.old,false);assert.equal(result.actual,true);rows.push({case:value,baseline:false,proposed:true});
}
for(const [name,html] of [
 ['wrongstate',dialog(section('Waiting for authorization'))],['checking',dialog(section('Checking authorization'))],
 ['substring',dialog(section('Connected eventually'))],['foreignglobal',dialog(section('Ready to connect'))+'<div>Connected</div>'],
 ['foreignserver',dialog(section(),'other')],['nodocument',''],['duplicateowner',dialog()+dialog()],
 ['inactiveowner',dialog().replace('data-modal-open="true"','data-modal-open="false"')],
 ['hiddenowner',dialog().replace('role="dialog"','hidden role="dialog"')],
 ['coveredowner',dialog().replace('role="dialog"','data-covered role="dialog"')],
 ['fadedowner',dialog().replace('role="dialog"','style="opacity:.5" role="dialog"')],
 ['duplicatestatus',dialog(section('Connected','<p role="status">Connected</p>'))],
 ['hiddenstatus',dialog(section().replace('<p role="status"','<p hidden role="status"'))],
 ['wrongsection',dialog(section().replace('>OAuth<','>Other<'))],
 ['duplicatename',dialog().replace('<section','<input aria-label="Server name" value="external-auth-fixture"><section')],
]){assert.equal(evaluate(html,'Connected').actual,false,name);rows.push({case:name,proposed:false});}
console.log(rows.length+' actual scoped OAuth status controls passed; four paragraph cases fail the old span/div selector.');
}
