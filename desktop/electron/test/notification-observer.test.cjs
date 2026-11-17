"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const {
  AttentionObserver,
  validBinding,
} = require("../src/attention-observer.cjs");
const engine = "10000000-0000-0000-0000-000000000001",
  epoch = "20000000-0000-0000-0000-000000000001";
const store = "30000000-0000-0000-0000-000000000001";
const frame = (value) =>
  `event: attention\n${value.boundary ? `id: ${engine}:${epoch}:${value.boundary.sequence}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
const baseline = {
  kind: "baseline",
  boundary: { engine, epoch, sequence: 0 },
  sources: [],
  reset: null,
};
const page = {
  kind: "completions",
  page: {
    store_id: store,
    cursor: 0,
    high_water: 0,
    baseline: true,
    more: false,
    items: [],
  },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((value) => {
    resolve = value;
  });
  return { promise, resolve };
};
async function server(t, handler) {
  const value = http.createServer(handler);
  value.listen(0, "127.0.0.1");
  await once(value, "listening");
  t.after(() => {
    value.closeAllConnections();
    value.close();
  });
  return {
    profile: "a".repeat(64),
    engine,
    endpoint: `http://127.0.0.1:${value.address().port}`,
  };
}

test("binding admits exact ephemeral loopback origin only, no credentials/path/remote fallback", () => {
  const binding = {
    profile: "a".repeat(64),
    engine,
    endpoint: "http://127.0.0.1:34567",
  };
  assert.equal(validBinding(binding), true);
  for (const endpoint of [
    "http://localhost:34567",
    "https://127.0.0.1:34567",
    "http://127.0.0.1:34567/other",
    "http://user@127.0.0.1:34567",
    "http://127.0.0.1:34567?secret=1",
    "http://example.com:34567",
  ])
    assert.equal(validBinding({ ...binding, endpoint }), false);
});

test("real passive GET uses semantic header; page ACK backpressures baseline; quiet stream holds one connection", async (t) => {
  let requestCount = 0,
    observed;
  const received = deferred(),
    accepted = deferred(),
    baselineSeen = deferred();
  const binding = await server(t, (req, res) => {
    ++requestCount;
    observed = req;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(frame(page) + frame(baseline));
  });
  const statuses = [];
  const observer = new AttentionObserver({
    page: async () => {
      received.resolve();
      await accepted.promise;
      return true;
    },
    notice: async () => true,
    status: (value) => {
      statuses.push(value);
      if (value.projectionAvailable) baselineSeen.resolve();
    },
  });
  t.after(() => observer.retire());
  observer.start(binding);
  await received.promise;
  assert.equal(observed.url, "/attention/events");
  assert.equal(observed.headers["x-nac-completion-cursor"], "new");
  assert.equal(observed.headers["last-event-id"], undefined);
  assert.equal(observed.method, "GET");
  assert.equal(observer.projection.boundary, null);
  accepted.resolve();
  await baselineSeen.promise;
  assert.equal(requestCount, 1);
  assert.equal(statuses.at(-1).tasks, 1);
  assert.equal(statuses.at(-1).retries, 0);
  await observer.retire();
  assert.equal(observer.active, null);
  assert.equal(observer.retry, null);
  assert.equal(observer.draining.size, 0);
});

test("redirect/auth rejection is terminal without adoption; malformed metadata stops, reset schedules one retry", async (t) => {
  for (const kind of ["redirect", "malformed", "reset"]) {
    const unavailable = deferred();
    let count = 0;
    const binding = await server(t, (_req, res) => {
      ++count;
      if (kind === "redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:1" });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          kind === "malformed"
            ? "event: attention\ndata: {}\n\n"
            : frame({ kind: "reset", reason: "replay_gap" }),
        );
      }
    });
    const observer = new AttentionObserver({
      page: async () => true,
      notice: async () => true,
      status: (value) => {
        if (value.phase === "unavailable") unavailable.resolve(value);
      },
    });
    observer.start(binding);
    const status = await unavailable.promise;
    assert.equal(status.retries, kind === "reset" ? 1 : 0);
    assert.equal(count, 1);
    await observer.retire();
    assert.equal(observer.retry, null);
  }
});

test("resolution metadata drains while decision save ACK is held, allowing exact current recheck", async (t) => {
  const source = { session_id: "chat", epoch },
    decision = { kind: "permission", request_id: "request" };
  const availability = {
    work: "available",
    permissions: "available",
    questions: "available",
    reviews: "available",
    topology: "available",
  };
  const entered = deferred(),
    resolved = deferred(),
    gate = deferred();
  let response, noticeValue, contextValue;
  const binding = await server(t, (_req, res) => {
    response = res;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      frame({
        ...baseline,
        sources: [
          {
            source,
            revision: 0,
            work: null,
            pending: [decision],
            availability,
          },
        ],
      }),
    );
  });
  const observer = new AttentionObserver({
    page: async () => true,
    notice: async (notice, context) => {
      noticeValue = notice;
      contextValue = context;
      entered.resolve();
      await gate.promise;
      return true;
    },
    resolved: (keys) => {
      if (keys.length) resolved.resolve();
    },
  });
  observer.start(binding, `${store}:0`);
  await entered.promise;
  assert.equal(observer.isCurrent(noticeValue, contextValue), true);
  response.write(
    frame({
      kind: "record",
      boundary: { engine, epoch, sequence: 1 },
      source,
      source_revision: 1,
      change: { kind: "decision_resolved", decision },
      new_attention: false,
    }),
  );
  await resolved.promise;
  assert.equal(observer.isCurrent(noticeValue, contextValue), false);
  gate.resolve();
  await observer.retire();
  assert.equal(observer.notices.size, 0);
});
