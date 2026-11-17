"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LaunchProtocol, LIMIT } = require("../src/protocol.cjs");
const identity = { product_version: "1", build_id: "owned", source_revision: "abc", track: "dev" };
function protocol() {
  return new LaunchProtocol(identity, "/private/tmp/fixture.db", 50);
}
function ready(p, changes = {}) {
  return Buffer.from(
    JSON.stringify({
      kind: "ready",
      version: 1,
      incarnation: p.incarnation,
      identity,
      store: p.store,
      schema: 50,
      endpoint: "http://127.0.0.1:41234",
      ...changes,
    }) + "\n",
  );
}
test("exact identity receipt accepts incremental chunks once", () => {
  const p = protocol(),
    bytes = ready(p);
  assert.equal(p.receive(bytes.subarray(0, 8)), null);
  assert.equal(p.receive(bytes.subarray(8)).endpoint, "http://127.0.0.1:41234");
  assert.throws(() => p.receive(bytes));
});
test("wrong identity/store/schema/incarnation/origin and extra fields refuse", () => {
  for (const change of [
    { identity: { ...identity, build_id: "other" } },
    { store: "/other" },
    { schema: 49 },
    { incarnation: "other" },
    { endpoint: "http://localhost:41234" },
    { endpoint: "http://127.0.0.1:65536" },
    { endpoint: "http://127.0.0.1:80@evil.test" },
    { extra: true },
  ])
    assert.throws(() => {
      const p = protocol();
      p.receive(ready(p, change));
    });
});
test("malformed, oversized and duplicate receipt in same read never publishes", () => {
  for (const make of [
    () => Buffer.from("{broken}\n"),
    () => Buffer.alloc(LIMIT + 1, 65),
    (p) => Buffer.concat([ready(p), ready(p)]),
  ])
    assert.throws(() => {
      const p = protocol();
      p.receive(make(p));
    });
});
test("occupied store and future schema stay distinct, arbitrary errors never displayed", () => {
  for (const code of ["store_owned", "store_schema_incompatible"]) {
    const p = protocol();
    assert.throws(
      () =>
        p.receive(
          Buffer.from(
            JSON.stringify({
              kind: "failed",
              version: 1,
              incarnation: p.incarnation,
              stage: "startup",
              code,
              message: "SECRET",
            }) + "\n",
          ),
        ),
      (error) => error.code === code && !error.message.includes("SECRET"),
    );
  }
});

test("any trailing receipt bytes fail immediately before publication", () => {
  const p = protocol();
  assert.throws(() => p.receive(Buffer.concat([ready(p), Buffer.from("{")])));
});
