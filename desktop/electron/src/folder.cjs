'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const folderBundle = resources => path.join(resources, 'NAC Folder Picker.app');
const folderExecutable = resources => path.join(folderBundle(resources), 'Contents', 'MacOS', 'native-folder-picker');

function folderPicker(initialPath, executable = folderExecutable(process.resourcesPath || path.join(__dirname, '..', 'build'))) {
  const child = spawn(executable, [initialPath], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env } });
  let cancelled = false, output = Buffer.alloc(0), ended = false;
  const promise = new Promise(resolve => {
    const settle = value => { if (!ended) { ended = true; resolve(value); } };
    child.stdout.on('data', bytes => {
      if (output.length + bytes.length > 20480) { cancel(); return; }
      output = Buffer.concat([output, bytes]);
    });
    child.once('error', () => settle(null));
    child.once('close', code => {
      clearTimeout(fallback);
      if (cancelled || code !== 0) { settle(null); return; }
      try {
        const value = JSON.parse(output.toString('utf8'));
        const selected = value.path;
        if (Object.keys(value).length !== 1 || (selected !== null &&
          (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0') ||
           Buffer.byteLength(selected) > 16384 || !fs.lstatSync(selected).isDirectory()))) { settle(null); return; }
        settle(selected);
      } catch { settle(null); }
    });
  });
  let fallback;
  function cancel() {
    if (cancelled || ended) return;
    cancelled = true;
    child.stdin.destroy();
    // This exact helper owns only its panel. It has no engine settlement work.
    fallback = setTimeout(() => { if (!ended) child.kill('SIGTERM'); }, 2000);
    fallback.unref();
  }
  return { promise, cancel };
}

module.exports = { folderPicker, folderBundle, folderExecutable };
