'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeAdapters } = require('../src/native.cjs');
const { externalURL } = require('../src/navigation.cjs');

const origin = 'http://127.0.0.1:32769';
const incarnation = '8262459c-c2c8-4f10-8ed9-b52faf623d5e';
const nonce = 'fd00340e-d62c-4e68-b992-b0c0260d03dc';

function fixture() {
  const messages = [], opened = [], picks = [];
  const session = new EventEmitter();
  session.setPermissionRequestHandler = value => { session.permission = value; };
  session.setPermissionCheckHandler = value => { session.check = value; };
  const frame = { url: origin + '/', send: (_channel, body) => messages.push(body) };
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame, session, getURL: () => origin + '/', isDestroyed: () => false,
    setWindowOpenHandler(value) { this.popup = value; },
  });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isVisible: () => true, isMinimized: () => false, isFocused: () => true });
  const ipcMain = new EventEmitter();
  const app = { isPackaged: false, isHidden: () => false };
  const electron = { ipcMain, app, shell: { openExternal: value => { opened.push(value); return Promise.resolve(); } }, dialog: {} };
  const native = createNativeAdapters({ window, endpoint: origin, incarnation, electron,
    pickFolder(initial) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const picker = { initial, promise, resolve, cancelled: false, cancel() { this.cancelled = true; } };
      picks.push(picker);
      return picker;
    },
  });
  const send = (kind, extra = {}, event = { sender: contents, senderFrame: frame }) =>
    ipcMain.emit('nac:native', event, { version: 1, kind, nonce, incarnation, ...extra });
  const ready = () => {
    send('ready');
    send('bound', { challenge: messages.at(-1).challenge });
    send('ui_ready');
  };
  return { native, app, send, ready, messages, opened, picks, contents, window, frame, ipcMain };
}

test('exact main frame, origin and fresh document bind every native operation', () => {
  const f = fixture();
  f.send('ready', {}, { sender: f.contents, senderFrame: { url: origin + '/', send() {} } });
  assert.equal(f.native.command('projects'), false);
  f.ready();
  f.send('external_link', { request: 1, url: 'https://example.com/auth?state=a%2Bb' }, { sender: {}, senderFrame: f.frame });
  assert.deepEqual(f.opened, []);
  f.send('external_link', { request: 1, url: 'https://example.com/auth?state=a%2Bb' });
  assert.deepEqual(f.opened, ['https://example.com/auth?state=a%2Bb']);
  f.send('external_link', { request: 1, url: 'https://example.com/replay' });
  f.send('external_link', { request: 2, url: 'file:///etc/passwd' });
  f.send('external_link', { request: 3, url: 'https://example.com/', unknown: true });
  assert.equal(f.opened.length, 1);
  f.contents.emit('did-start-navigation', {}, origin + '/', false, true);
  assert.equal(f.native.command('projects'), false);
  f.send('ui_ready');
  f.send('external_link', { request: 4, url: 'https://example.com/stale' });
  assert.equal(f.opened.length, 1);
  f.native.dispose();
  assert.equal(f.ipcMain.listenerCount('nac:native'), 0);
});

test('menu command is at most one live dispatch and hidden windows never dispatch', () => {
  const f = fixture(); f.ready();
  assert.equal(f.native.command('newSession'), true);
  assert.equal(f.native.command('settings'), false);
  const command = f.messages.find(message => message.kind === 'command').command;
  f.send('command_settled', { request: command.request, accepted: true });
  f.window.isFocused = () => false;
  assert.equal(f.native.command('settings'), false);
  f.window.isFocused = () => true;
  assert.equal(f.native.command('settings'), true);
  f.native.dispose();
});

test('hash routes retain document capabilities while real document replacement retires them', () => {
  const f = fixture(); f.ready();
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.equal(f.native.command('projects'), true);
  f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(f.native.command('settings'), false);
  f.native.dispose();
});

test('one native picker fences late answers after hide, replacement and retirement', async () => {
  const f = fixture(); f.ready();
  f.send('choose_directory', { request: 1, initialPath: '/tmp/Unicode folder α' });
  assert.equal(f.picks.length, 1);
  f.send('choose_directory', { request: 2, initialPath: '/tmp/other' });
  assert.equal(f.picks.length, 1);
  f.native.setVisible(false);
  assert.equal(f.picks[0].cancelled, true);
  f.picks[0].resolve('/tmp/Unicode folder α');
  await Promise.resolve();
  assert.equal(f.messages.filter(message => message.kind === 'directory').at(-1).path, null);
  f.send('choose_directory', { request: 3, initialPath: '/tmp/new' });
  const stopping = f.native.retire();
  f.send('retired', { closed: true });
  assert.equal(f.picks[1].cancelled, true);
  let resolved = false;
  stopping.then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  f.picks[1].resolve('/tmp/new');
  assert.equal(await stopping, true);
  assert.equal(f.native.command('projects'), false);
  f.native.dispose();
});

test('external policy rejects credentials, unsafe schemes, owned origin and invalid bytes', () => {
  for (const value of ['file:///tmp/a', 'javascript:alert(1)', 'https://user:pass@example.com/', origin + '/x', 'https://example.com/\nsecret']) {
    assert.equal(externalURL(value, origin), false, value);
  }
  assert.equal(externalURL('https://example.com/auth?state=%2Babc%3D', origin), true);
});

test('scripted popups, raw navigation, downloads and permission requests fail closed', () => {
  const f = fixture(); f.ready();
  assert.deepEqual(f.contents.popup({ url: 'https://example.com' }), { action: 'deny' });
  let denied = 0;
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) f.contents.emit(event, { preventDefault() { denied++; } });
  f.contents.session.emit('will-download', { preventDefault() { denied++; } }, {}, f.contents);
  assert.equal(denied, 4);
  f.contents.session.permission(f.contents, 'camera', allowed => assert.equal(allowed, false));
  assert.equal(f.contents.session.check(), false);
  f.native.dispose();
});

test("initial activation and later visibility share app-hidden and minimized facts", () => {
  const f = fixture();
  f.app.isHidden = () => true;
  f.ready();
  assert.equal(f.messages.find((message) => message.kind === "activate").visible, false);
  f.app.isHidden = () => false;
  f.window.isMinimized = () => true;
  f.native.visibilityChanged();
  assert.equal(f.messages.at(-1).visible, false);
  f.window.isMinimized = () => false;
  f.native.visibilityChanged();
  assert.equal(f.messages.at(-1).visible, true);
  f.native.dispose();
});
