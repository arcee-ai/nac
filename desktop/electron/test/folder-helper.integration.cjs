'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { folderExecutable, folderBundle } = require('../src/folder.cjs');

test('actual AppKit panel helper closes and is reaped on its dedicated channel EOF', async () => {
  const resources = process.env.NAC_ELECTRON_RESOURCES || path.join(__dirname, '..', 'build');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nac-folder-helper-'));
  for (const name of ['home', 'tmp']) fs.mkdirSync(path.join(directory, name));
  const observer = path.join(directory, 'window-observer');
  execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-O', '-framework', 'AppKit',
    path.resolve(__dirname, '../performance/WindowObserver.swift'), '-o', observer], { timeout: 30000 });
  const child = spawn(folderExecutable(resources), [''], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.join(directory, 'home'), TMPDIR: path.join(directory, 'tmp') } });
  let output = '', diagnostics = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { diagnostics += bytes; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const deadline = setTimeout(() => child.kill('SIGTERM'), 5000);
  try {
    let native;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      native = JSON.parse(execFileSync(observer, ['state', folderBundle(resources)], { encoding: 'utf8' }));
      if (native.apps.some(app => app.pid === child.pid && app.identity_available)) break;
    }
    assert.equal(native.apps.length, 1);
    assert.equal(native.apps[0].pid, child.pid);
    assert.equal(native.apps[0].identity_available, true);
    child.stdin.end();
    assert.deepEqual(await exited, { code: 0, signal: null }, diagnostics);
    assert.deepEqual(JSON.parse(output), { path: null });
  } finally {
    child.stdin.end();
    await exited;
    clearTimeout(deadline);
    fs.rmSync(directory, { recursive: true });
  }
});
