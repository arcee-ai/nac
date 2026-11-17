const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PacedProvider } = require('./paced-provider.cjs');

test('paces Unicode SSE deltas then preserves exact upstream completion and plain routes', async () => {
  const final = { type: 'response.output_item.done', item: { type: 'message',
    content: [{ text: 'hello🦀世界'.repeat(20) }] } };
  const original = 'data: ' + JSON.stringify(final) + '\n\n' +
    'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [final.item] } }) + '\n\n';
  const upstream = http.createServer((request, response) => {
    if (request.url === '/models-dev') response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"fixture":true}');
    else response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(original);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const paced = new PacedProvider(undefined, { frames: 3 });
  try {
    await paced.start('http://127.0.0.1:' + upstream.address().port);
    assert.deepEqual(await (await fetch(paced.baseUrl + '/models-dev')).json(), { fixture: true });
    const response = await fetch(paced.baseUrl + '/responses');
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const result = await response.text();
    assert.ok(result.endsWith(original));
    const deltas = result.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
      .filter(record => record.type === 'response.output_text.delta');
    assert.equal(deltas.length, 3);
    assert.equal(deltas.map(record => record.delta).join(''), final.item.content[0].text);
    assert.equal(paced.receipts[0].frame_count, 3);
    assert.ok(paced.receipts[0].elapsed_ms >= 40, 'actual pacing timer executed');
  } finally {
    await paced.stop();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('rejects an external upstream and unbounded pacing configuration', async () => {
  const paced = new PacedProvider();
  await assert.rejects(paced.start('https://example.com'), /owned loopback/);
  assert.throws(() => new PacedProvider(undefined, { frames: 181 }), /Bounded/);
});
