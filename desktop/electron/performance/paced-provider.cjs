const http = require('node:http');
const { performance } = require('node:perf_hooks');

// Fixture-only pacing around the existing shared provider. No vendor traffic,
// request logging, new model behavior, renderer bridge or production dependency.
class PacedProvider {
  constructor(upstreamURL, { frames = 60, hz = 30 } = {}) {
    if (!Number.isInteger(frames) || frames < 2 || frames > 180 || hz !== 30) {
      throw new Error('Bounded performance pacing requires 2..180 frames at30Hz');
    }
    this.frames = frames;
    this.hz = hz;
    this.upstreamURL = upstreamURL;
    this.baseUrl = '';
    this.receipts = [];
    this.sockets = new Set();
    this.pending = new Set();
  }

  async start(upstreamURL = this.upstreamURL) {
    const upstream = new URL(upstreamURL);
    if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' ||
        !upstream.port || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') {
      throw new Error('Pacing fixture accepts only the owned loopback provider');
    }
    this.server = http.createServer((request, response) => {
      const forwarded = http.request({ hostname: upstream.hostname, port: upstream.port,
        path: request.url, method: request.method, headers: { ...request.headers, host: upstream.host } }, incoming => {
        const task = this.respond(incoming, response).catch(() => response.destroy());
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
      });
      forwarded.on('error', () => response.destroy());
      request.on('error', () => forwarded.destroy());
      response.on('close', () => forwarded.destroy());
      request.pipe(forwarded);
    });
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.baseUrl = 'http://127.0.0.1:' + this.server.address().port;
  }

  async respond(incoming, response) {
    const type = incoming.headers['content-type'] ?? '';
    if (incoming.statusCode !== 200 || !type.includes('text/event-stream')) {
      response.writeHead(incoming.statusCode, incoming.headers);
      await new Promise((resolve, reject) => {
        incoming.on('error', reject); incoming.on('end', resolve); incoming.pipe(response);
      });
      return;
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) throw new Error('Fixture SSE exceeds2MiB');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const records = body.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const item = records.find(record => record.type === 'response.output_item.done')?.item;
    const text = item?.type === 'message' && item.content?.map(part => part.text ?? '').join('');
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    if (text) {
      const points = Array.from(text);
      const width = Math.max(1, Math.ceil(points.length / this.frames));
      const started = performance.now();
      const receipt = { target_hz: this.hz, maximum_frames: this.frames,
        frame_count: 0, delta_intervals_ms: [], elapsed_ms: null };
      let previous = started;
      for (let index = 0; index < points.length; index += width) {
        if (response.destroyed) throw new Error('Owned fixture stream closed');
        const now = performance.now();
        if (receipt.frame_count) receipt.delta_intervals_ms.push(now - previous);
        previous = now;
        response.write('data: ' + JSON.stringify({ type: 'response.output_text.delta',
          delta: points.slice(index, index + width).join('') }) + '\n\n');
        receipt.frame_count++;
        if (index + width < points.length) await new Promise(resolve => setTimeout(resolve, 1000 / this.hz));
      }
      receipt.elapsed_ms = performance.now() - started;
      this.receipts.push(receipt);
    }
    response.end(body);
  }

  async stop() {
    if (!this.server) return;
    for (const socket of this.sockets) socket.destroy();
    await new Promise(resolve => this.server.close(resolve));
    await Promise.allSettled([...this.pending]);
    this.server = null;
  }
}

module.exports = { PacedProvider };
