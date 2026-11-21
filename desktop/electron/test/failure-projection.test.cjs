const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectFailure, statusClass, annotateFailure, collectRendererFacts } = require('../performance/failure-projection.cjs');

test('projects only bounded allowlisted fixture facts', () => {
  const secret = 'private body header and url';
  const result = projectFailure(secret,
    [{ matchedStep: 'electron-history', body: secret }, ...Array(9).fill({ matchedStep: secret })],
    [{ frame_count: 60, text: secret }, { frame_count: 181 }, ...Array(8).fill({ frame_count: 0 })],
    ['2xx', secret, ...Array(8).fill('409')]);
  assert.equal(result.stage, 'unknown');
  assert.deepEqual(result.provider_steps.slice(0, 2), ['electron-history', 'unmatched']);
  assert.deepEqual(result.paced_frames.slice(0, 2), [60, 'unknown']);
  assert.equal(result.run_responses[1], 'other');
  assert.equal(result.provider_steps.length, 8);
  assert.equal(result.paced_frames.length, 8);
  assert.equal(result.run_responses.length, 8);
  assert.equal(result.provider_requests_truncated, true);
  assert.equal(result.paced_receipts_truncated, true);
  assert.equal(result.run_responses_truncated, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('response categories preserve conflict distinctly', () => {
  assert.deepEqual([202, 409, 400, 503, 302].map(statusClass), ['2xx', '409', '4xx', '5xx', 'other']);
});

test('keeps the original error even if diagnostics fail', () => {
  const failure = new Error('original failure');
  assert.equal(annotateFailure(failure, 'history-marker', [], [], []), failure);
  assert.match(failure.message, /^original failure\nClosed performance failure facts:/);
  const frozen = Object.freeze(new Error('frozen'));
  assert.equal(annotateFailure(frozen, 'unknown', null, [], []), frozen);
  assert.equal(frozen.message, 'frozen');
});



function fakeDocument(texts) {
  return { body: {}, createTreeWalker() {
    let index = 0;
    return { nextNode() {
      if (index >= texts.length) return null;
      const text = texts[index++];
      return { length: text.length, substringData: (start, count) => text.slice(start, start + count) };
    } };
  } };
}

test('renderer facts reveal only bounded allowlisted scalars', async () => {
  const secret = 'sensitive-private-content';
  const id = '5c26d9ef-928d-4563-9794-370479d60e71';
  const originals = { window: global.window, location: global.location, document: global.document, fetch: global.fetch };
  try {
    global.window = { __nacPerformanceFailureContext: { session: id, marker: 'PERF_STREAM_END', mutationCount: () => 24 } };
    global.location = { hash: '#/session/' + id + '/files' };
    global.document = fakeDocument([secret]);
    global.fetch = async route => {
      assert.equal(route, '/attention');
      return new Response(JSON.stringify({ sessions: [{ session_id: id, activity: {kind:'idle'},
        last_outcome: {disposition:'completed'}, recovery_pending: false, secret }] }));
    };
    const facts = await collectRendererFacts();
    assert.deepEqual(facts, { route_matches: true, dom_text_node_marker: false, attention: 'ok',
      activity: 'idle', last_outcome: 'completed', recovery_pending: false, mutation_bucket: '10-99' });
    const output = projectFailure('stream-marker', [], [], [], { ...facts, secret });
    assert.equal(JSON.stringify(output).includes(secret), false);
    assert.equal(JSON.stringify(output).includes(id), false);
    assert.equal(JSON.stringify(output).includes('PERF_STREAM_END'), false);
    const poisoned = projectFailure('stream-marker', [], [], [], { route_matches: secret,
      dom_text_node_marker: secret, attention: secret, activity: secret,
      last_outcome: secret, recovery_pending: secret, mutation_bucket: secret });
    assert.equal(JSON.stringify(poisoned).includes(secret), false);
  } finally {
    Object.assign(global, originals);
  }
});

test('passive census rejects foreign, invalid and oversized data', async () => {
  const id = '5c26d9ef-928d-4563-9794-370479d60e71';
  const originals = { window: global.window, location: global.location, document: global.document, fetch: global.fetch };
  try {
    global.window = { __nacPerformanceFailureContext: { session: id, marker: 'PERF_STREAM_END', mutationCount: () => 0 } };
    global.location = { hash: '#/session/' + id + '/files' };
    global.document = fakeDocument([]);
    global.fetch = async () => new Response(JSON.stringify({ sessions: [{ session_id: 'foreign' }] }));
    assert.equal((await collectRendererFacts()).attention, 'invalid');
    global.fetch = async () => new Response(JSON.stringify({ sessions: [{ session_id: id }, { session_id: id }] }));
    assert.equal((await collectRendererFacts()).attention, 'invalid');
    global.fetch = async () => new Response(JSON.stringify({ sessions: [{ session_id: id }] }));
    const partial = await collectRendererFacts();
    assert.equal(partial.attention, 'ok');
    assert.equal(partial.activity, 'unknown');
    assert.equal(partial.last_outcome, 'unknown');
    global.fetch = async () => new Response('x'.repeat(1024 * 1024 + 1));
    assert.equal((await collectRendererFacts()).attention, 'oversize');
    global.window.__nacPerformanceFailureContext.session = '../unsafe';
    global.fetch = async () => { throw Error('must not fetch'); };
    assert.equal((await collectRendererFacts()).attention, 'unknown');
  } finally {
    Object.assign(global, originals);
  }
});


test('oversized DOM yields unknown and passive census is bounded by timeout', async () => {
  const id = '5c26d9ef-928d-4563-9794-370479d60e71';
  const originals = { window: global.window, location: global.location, document: global.document, fetch: global.fetch };
  try {
    global.window = { __nacPerformanceFailureContext: { session: id, marker: 'PERF_STREAM_END', mutationCount: () => 0 } };
    global.location = { hash: '#/session/' + id + '/files' };
    global.document = fakeDocument(['x'.repeat(65537) + 'PERF_STREAM_END']);
    global.fetch = async (_route, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const started = performance.now();
    const facts = await collectRendererFacts();
    assert.equal(facts.dom_text_node_marker, 'unknown');
    assert.equal(facts.attention, 'timeout');
    assert.ok(performance.now() - started < 1500);
  } finally { Object.assign(global, originals); }
});
