// Closed, bounded fixture-only failure facts. Never project request bodies,
// URLs, headers, arbitrary exceptions or renderer content. Stage names mark the
// last entered phase; an empty pacing list means no completed receipt, not that
// a stream never started.
const stages = new Set(['history-marker', 'history-complete', 'stream-marker', 'stream-complete']);
const steps = new Set(['electron-history', 'electron-stream']);
const statuses = new Set(['2xx', '409', '4xx', '5xx', 'other']);
const attentionStates = new Set(['ok', 'http-error', 'timeout', 'oversize', 'invalid', 'unknown']);
const runStates = new Set(['run', 'idle', 'manual', 'compaction', 'unknown']);
const outcomes = new Set(['completed', 'failed', 'cancelled', 'none', 'unknown']);
const buckets = new Set(['0', '1-9', '10-99', '100+', 'unknown']);
const safeBoolean = value => typeof value === 'boolean' ? value : 'unknown';

// Executed only after a failed probe in its disposable renderer. No input,
// arbitrary DOM text, URLs, IDs, messages, or exceptions leave the document.
// The read is same-origin and bounded in time and bytes.
async function collectRendererFacts() {
  const facts = { route_matches: 'unknown', dom_text_node_marker: 'unknown',
    attention: 'unknown', activity: 'unknown', last_outcome: 'unknown', recovery_pending: 'unknown',
    mutation_bucket: 'unknown' };
  const context = window.__nacPerformanceFailureContext;
  if (!context || typeof context.session !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(context.session) ||
      !['PERF_HISTORY_END', 'PERF_STREAM_END'].includes(context.marker)) return facts;
  facts.route_matches = location.hash === '#/session/' + context.session + '/files';
  if (document.body) {
    // Inspect only bounded pieces of text nodes. A truncated scan is unknown;
    // no layout/innerText walk or raw renderer text is emitted.
    const walker = document.createTreeWalker(document.body, 4);
    const deadline = performance.now() + 20;
    let chars = 0;
    let nodes = 0;
    let complete = false;
    let found = false;
    while (nodes < 512 && chars < 65536 && performance.now() < deadline) {
      const node = walker.nextNode();
      if (!node) { complete = true; break; }
      nodes++;
      const remaining = 65536 - chars;
      const count = Math.min(node.length, remaining);
      found = node.substringData(0, count).includes(context.marker);
      chars += count;
      if (found) break;
      if (node.length > count) break;
    }
    facts.dom_text_node_marker = found ? true : complete ? false : 'unknown';
  }
  const count = typeof context.mutationCount === 'function' ? context.mutationCount() : null;
  if (Number.isSafeInteger(count) && count >= 0) {
    facts.mutation_bucket = count === 0 ? '0' : count < 10 ? '1-9' : count < 100 ? '10-99' : '100+';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch('/attention', { signal: controller.signal });
    if (!response.ok) { facts.attention = 'http-error'; return facts; }
    if (!response.body) { facts.attention = 'invalid'; return facts; }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 * 1024) { controller.abort(); facts.attention = 'oversize'; return facts; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const census = JSON.parse(new TextDecoder().decode(bytes));
    if (!census || !Array.isArray(census.sessions)) { facts.attention = 'invalid'; return facts; }
    const matches = census.sessions.filter(entry => entry?.session_id === context.session);
    if (matches.length !== 1) { facts.attention = 'invalid'; return facts; }
    const entry = matches[0];
    facts.attention = 'ok';
    facts.activity = ['run', 'idle', 'manual', 'compaction'].includes(entry.activity?.kind)
      ? entry.activity.kind : 'unknown';
    facts.last_outcome = !Object.hasOwn(entry, 'last_outcome') ? 'unknown' :
      entry.last_outcome === null ? 'none' :
        ['completed', 'failed', 'cancelled'].includes(entry.last_outcome?.disposition)
          ? entry.last_outcome.disposition : 'unknown';
    facts.recovery_pending = typeof entry.recovery_pending === 'boolean' ? entry.recovery_pending : 'unknown';
  } catch {
    facts.attention = controller.signal.aborted ? 'timeout' : 'unknown';
  } finally { clearTimeout(timeout); }
  return facts;
}

function projectRenderer(value) {
  const input = value && typeof value === 'object' ? value : {};
  return { route_matches: safeBoolean(input.route_matches),
    dom_text_node_marker: safeBoolean(input.dom_text_node_marker),
    attention: attentionStates.has(input.attention) ? input.attention : 'unknown',
    activity: runStates.has(input.activity) ? input.activity : 'unknown',
    last_outcome: outcomes.has(input.last_outcome) ? input.last_outcome : 'unknown',
    recovery_pending: safeBoolean(input.recovery_pending),
    mutation_bucket: buckets.has(input.mutation_bucket) ? input.mutation_bucket : 'unknown' };
}

function projectFailure(stage, requests, receipts, responses, renderer) {
  return {
    stage: stages.has(stage) ? stage : 'unknown',
    renderer: projectRenderer(renderer),
    provider_steps: requests.slice(0, 8).map(request =>
      steps.has(request.matchedStep) ? request.matchedStep : 'unmatched'),
    provider_requests_truncated: requests.length > 8,
    paced_frames: receipts.slice(0, 8).map(receipt =>
      Number.isInteger(receipt.frame_count) && receipt.frame_count >= 0 && receipt.frame_count <= 180
        ? receipt.frame_count : 'unknown'),
    paced_receipts_truncated: receipts.length > 8,
    run_responses: responses.slice(0, 8).map(status => statuses.has(status) ? status : 'other'),
    run_responses_truncated: responses.length > 8,
  };
}

function statusClass(status) {
  if (status === 409) return '409';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

function annotateFailure(error, stage, requests, receipts, responses, renderer) {
  try {
    if (error instanceof Error) {
      const detail = '\nClosed performance failure facts: ' +
        JSON.stringify(projectFailure(stage, requests, receipts, responses, renderer));
      error.message += detail;
      if (error.stack) error.stack += detail;
    }
  } catch {
    // Optional diagnostics never replace the original failure.
  }
  return error;
}

module.exports = { projectFailure, statusClass, annotateFailure, collectRendererFacts };
