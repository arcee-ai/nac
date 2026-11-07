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
