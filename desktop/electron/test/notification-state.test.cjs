"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  defaults,
  decodeState,
  destination,
  sequence,
} = require("../src/notification-state.cjs");
const {
  AttentionSSEParser,
  completionPage,
} = require("../src/attention-protocol.cjs");
const { AttentionProjection } = require("../src/attention-projection.cjs");
const engine = "10000000-0000-0000-0000-000000000001";
const epoch = "20000000-0000-0000-0000-000000000001";
const store = "30000000-0000-0000-0000-000000000001";
const source = { session_id: "chat α", epoch };
const availability = {
  work: "available",
  questions: "available",
  permissions: "available",
  reviews: "available",
  topology: "available",
};
const permission = { kind: "permission", request_id: "request" };
const baseline = () => ({
  kind: "baseline",
  boundary: { engine, epoch, sequence: 0 },
  reset: null,
  sources: [{ source, revision: 0, work: null, pending: [], availability }],
});
const record = (sequence, change, fresh = false) => ({
  kind: "record",
  boundary: { engine, epoch, sequence },
  source,
  source_revision: sequence,
  change,
  new_attention: fresh,
});
const sse = (value) =>
  Buffer.from(
    `event: attention\nid: ${engine}:${epoch}:${value.boundary.sequence}\ndata: ${JSON.stringify(value)}\n\n`,
  );

test("strict Swift payload compatibility: absent means default off; optional legacy keys migrate without enabling", () => {
  assert.equal(defaults().enabled, false);
  assert.deepEqual(decodeState({ enabled: false, receipts: [] }), defaults());
  const state = {
    ...defaults(),
    enabled: true,
    cutoff: `${store}:0`,
    frontier: `${store}:3`,
    receipts: [
      {
        occurrence: `${store}:3`,
        session: "chat",
        cursor: `${store}:3`,
        phase: "reserved",
      },
    ],
  };
  assert.deepEqual(decodeState(state), state);
  for (const bad of [
    { ...state, version: 1 },
    { ...state, enabled: 1 },
    { ...state, muted: 1 },
    { ...state, frontier: null },
    { ...state, unreadCompletions: Number.MAX_SAFE_INTEGER + 1 },
    { ...state, receipts: [...state.receipts, ...state.receipts] },
    { ...state, seenDecisions: ["bad"] },
  ])
    assert.equal(decodeState(bad), null);
  assert.equal(sequence(`${store}:3`, store), 3);
  assert.equal(sequence(`${store}:03`, store), null);
  assert.throws(() => destination("a".repeat(64), "chat\n", "event"));
  assert.equal(
    destination("a".repeat(64), "chat", "event").identifier,
    "nac-attention-419aa3f290e3b627c15fb828dcd1d3cebdf096e6305dfa26ef98b16ab9df45eb",
  );
});

test("incremental SSE handles split UTF8, CRLF, exact event IDs and original ACK backpressure", async () => {
  const parser = new AttentionSSEParser(),
    frames = [];
  const buffer = sse(baseline());
  for (const byte of buffer)
    await parser.consume(Buffer.of(byte), (value) => frames.push(value));
  assert.deepEqual(frames, [baseline()]);
  const crlf = Buffer.from(sse(baseline()).toString().replaceAll("\n", "\r\n"));
  await new AttentionSSEParser().consume(crlf, (value) =>
    assert.deepEqual(value, baseline()),
  );
  let release,
    received = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const work = new AttentionSSEParser().consume(
    Buffer.concat([buffer, buffer]),
    async () => {
      ++received;
      await gate;
      return true;
    },
  );
  await Promise.resolve();
  assert.equal(received, 1);
  release();
  await work;
  assert.equal(received, 2);
  for (const bad of [
    buffer.toString().replace("event: attention", "event: transcript"),
    buffer.toString().replace(`id: ${engine}`, `id: ${epoch}`),
    buffer
      .toString()
      .replace("event: attention", "event: attention\nid: duplicate"),
    'event: attention\ndata: {"kind":"completions","page":{}}\n\n',
  ]) {
    await assert.rejects(
      new AttentionSSEParser().consume(Buffer.from(bad), () => true),
    );
  }
  await assert.rejects(
    new AttentionSSEParser().consume(
      Buffer.alloc(8 * 1024 * 1024 + 1, 65),
      () => true,
    ),
  );
});

test("completion pages keep exact bounded semantic shape and reject unsafe integer precision", () => {
  const page = {
    store_id: store,
    cursor: 1,
    high_water: 1,
    baseline: false,
    more: false,
    items: [
      {
        sequence: 1,
        session_id: "chat",
        run_id: "run",
        behavior: "direct",
        kind: "goal",
        goal_id: "goal",
        mark_version: 0,
      },
    ],
  };
  assert.deepEqual(completionPage(page), page);
  for (const bad of [
    { ...page, cursor: 0 },
    { ...page, baseline: true },
    { ...page, extra: true },
    { ...page, cursor: 2 ** 53 },
    { ...page, items: [...page.items, ...page.items] },
    { ...page, items: [{ ...page.items[0], kind: "request" }] },
    { ...page, items: [{ ...page.items[0], behavior: "orchestrator" }] },
    { ...page, items: [{ ...page.items[0], behavior: "direct-with-orchestrator" }] },
  ])
    assert.throws(() => completionPage(bad));
});

test("projection fences source/engine/revisions; availability unknown never resolves; replay stays silent", () => {
  const projection = new AttentionProjection();
  projection.accept(baseline(), engine);
  let effect = projection.accept(
    record(1, { kind: "decision_pending", decision: permission }, true),
    engine,
  );
  assert.equal(effect.notices.length, 1);
  const notice = effect.notices[0];
  assert.equal(projection.isCurrent(notice), true);
  assert.equal(
    projection.accept(
      record(1, { kind: "decision_pending", decision: permission }, true),
      engine,
    ).notices.length,
    0,
  );
  effect = projection.accept(
    record(2, {
      kind: "availability",
      availability: { ...availability, permissions: "unknown" },
    }),
    engine,
  );
  assert.deepEqual(effect.resolved, []);
  assert.equal(projection.isCurrent(notice), false);
  effect = projection.accept(
    record(3, { kind: "decision_resolved", decision: permission }),
    engine,
  );
  assert.equal(effect.resolved.length, 1);
  assert.equal(
    projection.accept(
      record(4, { kind: "decision_pending", decision: permission }, true),
      engine,
    ).notices.length,
    0,
  );
  assert.throws(() =>
    projection.accept(record(6, { kind: "checkpoint" }), engine),
  );
  assert.throws(() => new AttentionProjection().accept(baseline(), epoch));
});

test("baseline pending resumes for persistent dedup; new_attention false restoration silent; no work heuristic", () => {
  const projection = new AttentionProjection(),
    value = baseline();
  value.sources[0].pending = [permission];
  assert.equal(projection.accept(value, engine).notices.length, 1);
  const other = { kind: "permission", request_id: "restored" };
  assert.equal(
    projection.accept(
      record(1, { kind: "decision_pending", decision: other }),
      engine,
    ).notices.length,
    0,
  );
  assert.equal(
    projection.accept(
      record(
        2,
        {
          kind: "work_settled",
          work: { run_id: "run", goal: null, disposition: "completed" },
        },
        true,
      ),
      engine,
    ).notices.length,
    0,
  );
});
