import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';

const configPath = path.resolve(process.argv[2] ?? 'config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const root = path.resolve(config.output);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(path.join(root, 'assets'), { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
const revisions = [];
const servers = [];
const immutable = (sha) => /^[0-9a-f]{40}$/.test(sha);
for (const [index, revision] of config.revisions.entries()) {
  if (!immutable(revision.sha) || !immutable(revision.backendSha)) throw Error('Use exact 40-character frontend and backend SHAs; no branch names.');
  const resolved = execFileSync('git', ['rev-parse', revision.sha], { cwd: config.repo, encoding: 'utf8' }).trim();
  if (resolved !== revision.sha) throw Error(`Unexpected frontend SHA ${resolved}`);
  const assetTree = execFileSync('git', ['rev-parse', `${revision.sha}:crates/nac-server/assets/dist`], { cwd: config.repo, encoding: 'utf8' }).trim();
  const dest = path.join(root, 'assets', String(index));
  await fs.mkdir(dest, { recursive: false });
  const archive = execFileSync('git', ['archive', revision.sha, 'crates/nac-server/assets/dist'], { cwd: config.repo, maxBuffer: 128 * 1024 * 1024 });
  const extraction = spawnSync('tar', ['-xf', '-', '-C', dest, '--strip-components=4'], { input: archive });
  if (extraction.status) throw Error(extraction.stderr.toString());
  const backend = new URL(revision.backend);
  if (!['127.0.0.1', 'localhost'].includes(backend.hostname)) throw Error('Only a disposable loopback fixture backend is permitted.');
  const health = await fetch(new URL("/projects", backend));
  if (!health.ok) throw Error(`Fixture backend ${backend} is not healthy (${health.status})`);
  const port = (config.firstPort ?? 4870) + index;
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.startsWith('/assets/dist/') ? decodeURIComponent(url.pathname.slice('/assets/dist/'.length)) : null;
      if (relative !== null) {
        const filename = path.resolve(dest, relative);
        if (!filename.startsWith(dest + path.sep)) { response.writeHead(400).end(); return; }
        const data = await fs.readFile(filename);
        response.writeHead(200, { 'content-type': mime[path.extname(filename)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(data);
        return;
      }
      const headers = { ...request.headers, host: backend.host };
      if (headers.origin) headers.origin = backend.origin;
      const upstream = http.request(new URL(request.url, backend), { method: request.method, headers }, (reply) => {
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      });
      upstream.on('error', (error) => response.writeHead(502).end(String(error)));
      request.pipe(upstream);
    } catch (error) { response.writeHead(404).end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  servers.push(server);
  revisions.push({ ...revision, index, assetTree, origin });
}
const served = { ...config, output: root, startedAt: new Date().toISOString(), pid: process.pid, revisions };
await fs.writeFile(path.join(root, 'served.json'), JSON.stringify(served, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ manifest: path.join(root, 'served.json'), origins: revisions.map((revision) => revision.origin) }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const server of servers) server.close(); process.exit(0); });
