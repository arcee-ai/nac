import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
assert.equal(args.length,2);assert.equal(args[0],'--state');assert.ok(path.isAbsolute(args[1]));
const state=args[1];
const identity=JSON.parse(await fs.readFile(path.join(state,'identity.json'),'utf8'));
const binary=process.env.NAC_E2E_BINARY;
assert.ok(binary&&path.isAbsolute(binary));
const version=(await fs.readFile(path.join(root,'version.txt'),'utf8')).trim();
const expected={product_version:version,source_revision:identity.source,track:'dev',build_id:`dev-${identity.source}`};
const binaryVersion=await execute(binary,['--version'],{timeout:15_000,maxBuffer:1024*1024});
assert.equal(binaryVersion.stdout.trim(),`nac-web ${version} (${identity.source.slice(0,12)})`);
const guide=JSON.parse((await execute(binary,['guide','skills','discovery'],{timeout:15_000,maxBuffer:1024*1024})).stdout);
assert.equal(guide.provenance,'first-party bundled NAC Guide');assert.deepEqual(guide.build_identity,expected);
await fs.writeFile(path.join(state,'offline-guide.json'),JSON.stringify(guide,null,2));

async function hash(filename) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(filename))digest.update(chunk);
  return digest.digest('hex');
}

const web=path.join(root,'crates/nac-server/web');
const pins=JSON.parse(await fs.readFile(path.join(web,'node_modules/playwright-core/browsers.json'),'utf8'));
const pin=pins.browsers.find(p=>p.name==='chromium-headless-shell');assert.ok(pin);
const {chromium}=await import(pathToFileURL(path.join(web,'node_modules/playwright/index.mjs')).href);
let server,browser;
const started=Date.now();
try {
  server=await chromium.launchServer({headless:true});
  const executable=await fs.realpath(server.process().spawnfile);
  assert.ok(executable.includes(`chromium_headless_shell-${pin.revision}`));
  const libraries=await execute('ldd',[executable],{timeout:15_000,maxBuffer:1024*1024});
  assert.doesNotMatch(libraries.stdout,/not found/);
  await fs.writeFile(path.join(state,'chromium-ldd.log'),libraries.stdout);
  browser=await chromium.connect(server.wsEndpoint());
  assert.equal(browser.version(),pin.browserVersion);
  const page=await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><p>Native font probe Ω 中文 ไทย</p>');
  const width=await page.evaluate(async()=>{
    await document.fonts.ready;
    const context=document.createElement('canvas').getContext('2d');
    context.font='16px sans-serif';return context.measureText('Native Ω 中文 ไทย').width;
  });
  assert.ok(Number.isFinite(width)&&width>0);
  await fs.writeFile(path.join(state,'browser.json'),JSON.stringify({build_identity:expected,
    binary_sha256:await hash(binary),chromium_revision:pin.revision,chromium_version:browser.version(),
    chromium_executable_sha256:await hash(executable),font_canvas_width:width},null,2));
  await fs.writeFile(path.join(state,'browser-audit.json'),JSON.stringify({executable,
    pid:server.process().pid,seconds:(Date.now()-started)/1000},null,2));
} finally {
  try { await browser?.close(); } finally { await server?.close(); }
}
