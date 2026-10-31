const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require(path.resolve(__dirname, '../../crates/nac-server/web/node_modules/@playwright/test'));

const swift = fs.readFileSync(path.join(__dirname, 'InstanceSmoke.swift'), 'utf8');
function source(name) {
  const pattern = new RegExp(`${name} = #"""\\n([\\s\\S]*?)\\n    """#`, 'g');
  const matches = [...swift.matchAll(pattern)];
  assert.equal(matches.length, 1);
  return matches[0][1];
}
const observation = source('workspaceObservationScript');
const diagnostics = source('workspaceDiagnosticsScript');
const origin = 'https://instance-fixture.invalid';
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const empty = '<p>No projects yet</p><p>Create your first and start building!</p>' +
  '<p>Externally owned disposable instance workspace characterization.</p><button>Get Started</button>';
const project = '<div role="button" data-item-kind="project" data-item-id="fixture-project">' +
  'Native instance drain fixture <span>1 Session</span> Externally owned disposable workspace project.</div>';
const html = (body, script = '') => `<html><head><meta charset="utf-8"></head><body><div id="root">${body}</div><script>${script}</script></body></html>`;
async function withPage(body, action, script = '') {
  const page = await browser.newPage();
  try {
    await page.addInitScript(diagnostics);
    await page.route(origin + '/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html(body, script) }));
    await page.goto(origin + '/', { waitUntil: 'load' });
    await action(page);
  } finally { await page.close(); }
}
const observe = (page, expectedOrigin = origin) => page.evaluate(Function('expectedOrigin', observation), expectedOrigin);
const readyPredicate = Function('expectedOrigin', `return (() => {${observation}})().ready;`);

test('completed loading document stays unready until visible enabled empty-workspace semantics', async () => {
  await withPage('Loading workspace configuration…', async page => {
    const initial = await observe(page);
    assert.equal(initial.ready_state, 'complete');
    assert.equal(initial.ready, false);
    assert.equal(initial.body_length, 32);
    await page.evaluate(body => { document.getElementById('root').innerHTML = body; }, empty);
    const ready = await observe(page);
    assert.equal(ready.ready, true);
    assert.equal(ready.semantic, 'empty-onboarding');
    assert.ok(ready.body_length > 80);
  });
});

test('blank and long unrelated documents never satisfy workspace semantics', async () => {
  for (const body of ['', 'Loading irrelevant content '.repeat(20)]) {
    await withPage(body, async page => {
      for (let attempt = 0; attempt < 3; attempt++) assert.equal((await observe(page)).ready, false);
    });
  }
});

test('hidden or disabled onboarding action cannot establish visible workspace readiness', async () => {
  for (const attribute of ['disabled', 'style="display:none"', 'style="visibility:hidden"']) {
    await withPage(empty.replace('<button>', `<button ${attribute}>`), async page => {
      assert.equal((await observe(page)).ready, false);
    });
  }
});

test('only the exact rendered drain fixture project satisfies populated workspace semantics', async () => {
  await withPage(project, async page => {
    assert.equal((await observe(page)).semantic, 'drain-fixture-project');
    assert.equal((await observe(page)).ready, true);
    await page.evaluate(() => { document.querySelector('[role=button]').textContent = 'Different project '.repeat(20); });
    assert.equal((await observe(page)).ready, false);
  });
});

test('wrong origin, route, missing root or missing document-start diagnostics stays unready', async () => {
  await withPage(empty, async page => {
    assert.equal((await observe(page, 'https://another-fixture.invalid')).ready, false);
    await page.evaluate(() => { location.hash = '#/wrong'; });
    assert.equal((await observe(page)).ready, false);
    await page.evaluate(() => { location.hash = '#/'; delete window.__nacInstanceWorkspace; });
    assert.equal((await observe(page)).ready, false);
  });
  await withPage(empty, async page => {
    await page.evaluate(() => { document.getElementById('root').removeAttribute('id'); });
    assert.equal((await observe(page)).ready, false);
  });
});

test('server error text cannot be disguised with valid onboarding controls', async () => {
  await withPage(empty + '<p>Internal Server Error</p>', async page => assert.equal((await observe(page)).ready, false));
});

test('actual document-start JavaScript failure remains explainable and cannot pass', async () => {
  await withPage(empty, async page => {
    const state = await observe(page);
    assert.equal(state.ready, false);
    assert.ok(state.errors.some(error => error.kind === 'javascript-error' && error.message.includes('BOOTSTRAP_CANARY')));
    assert.ok(state.body_text.includes('No projects yet'));
  }, 'throw new Error("BOOTSTRAP_CANARY");');
});

test('unhandled rejection is captured before semantic readiness is considered', async () => {
  await withPage(empty, async page => {
    await page.waitForFunction(() => window.__nacInstanceWorkspace.events.some(event => event.kind === 'unhandled-rejection'));
    assert.equal((await observe(page)).ready, false);
  }, 'Promise.reject(new Error("REJECTION_CANARY"));');
});

test('resource failure retains the actual resource URL', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(diagnostics);
    await page.route(origin + '/**', route => route.fulfill(route.request().url().endsWith('/missing.js')
      ? { status: 404, contentType: 'text/javascript', body: '' }
      : { status: 200, contentType: 'text/html', body: html(empty) + '<script src="/missing.js"></script>' }));
    await page.goto(origin + '/', { waitUntil: 'load' });
    const state = await observe(page);
    assert.equal(state.ready, false);
    assert.ok(state.errors.some(error => error.kind === 'resource-error' && error.url.endsWith('/missing.js')));
    assert.ok(state.resources.some(resource => resource.url.endsWith('/missing.js')));
  } finally { await page.close(); }
});

test('body, HTML, event and resource diagnostics remain bounded', async () => {
  await withPage('X'.repeat(30000), async page => {
    await page.evaluate(() => {
      for (let index = 0; index < 40; index++) window.dispatchEvent(new ErrorEvent('error', { message: 'X'.repeat(10000) }));
    });
    const state = await observe(page);
    assert.equal(state.ready, false);
    assert.equal(state.body_text.length, 8000);
    assert.equal(state.root_html.length, 4000);
    assert.equal(state.errors.length, 16);
    assert.ok(state.errors.every(error => error.message.length <= 1500 && error.url.length <= 500));
    assert.ok(state.resources.length <= 24 && state.buttons.length <= 16);
  });
});

test('exact production empty UI waits for its real configuration query, then passes semantics', {
  skip: !process.env.NAC_INSTANCE_WORKSPACE_EMPTY_URL,
}, async () => {
  const endpoint = process.env.NAC_INSTANCE_WORKSPACE_EMPTY_URL;
  const page = await browser.newPage();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  try {
    await page.addInitScript(diagnostics);
    await page.route(endpoint + '/ui-config', async route => { await barrier; await route.continue(); });
    await page.goto(endpoint + '/#/', { waitUntil: 'load' });
    const pending = await observe(page, endpoint);
    assert.equal(pending.ready, false);
    assert.ok(pending.body_text.includes('Loading workspace configuration'));
    release();
    await page.waitForFunction(readyPredicate, endpoint, { timeout: 15000 });
    assert.equal((await observe(page, endpoint)).semantic, 'empty-onboarding');
  } finally { release(); await page.close(); }
});

test('exact production populated shutdown-fixture UI passes the expected project semantic', {
  skip: !process.env.NAC_INSTANCE_WORKSPACE_DRAIN_URL,
}, async () => {
  const endpoint = process.env.NAC_INSTANCE_WORKSPACE_DRAIN_URL;
  const page = await browser.newPage();
  try {
    await page.addInitScript(diagnostics);
    await page.goto(endpoint + '/#/', { waitUntil: 'load' });
    await page.waitForFunction(readyPredicate, endpoint, { timeout: 15000 });
    assert.equal((await observe(page, endpoint)).semantic, 'drain-fixture-project');
  } finally { await page.close(); }
});
