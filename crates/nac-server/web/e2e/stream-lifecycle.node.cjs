const { test } = require("node:test");
const assert = require("node:assert/strict");
const { streamLifecycle } = require("./stream-lifecycle.cjs");

test("records bounded ordered categories without request IDs or errors", () => {
  const observation = streamLifecycle();
  observation.request("private-id");
  observation.response("private-id", "EventSource", 200);
  observation.failed("private-id", "net::ERR_ABORTED");
  observation.finished("unknown-id");
  observation.response("another-secret", "unexpected", 503);
  const result = observation.snapshot(new Set(["another-secret"]));
  assert.deepEqual(result.events, [
    { request: 1, kind: "request" },
    { request: 1, kind: "response", detail: "eventsource:200" },
    { request: 1, kind: "failed", detail: "aborted" },
    { request: 2, kind: "response", detail: "other:other" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|unknown|secret/);
  assert.deepEqual(result.active_requests, [2]);
  for (let i = 0; i < 200; i++) observation.request(`id-${i}`);
  assert.equal(observation.snapshot(new Set()).truncated, true);
  assert.ok(observation.snapshot(new Set()).events.length <= 128);
});
