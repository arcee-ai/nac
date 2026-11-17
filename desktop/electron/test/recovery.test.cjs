"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReadiness, routeFragment } = require("../src/recovery.cjs");
const pinned = {
  endpoint: "http://127.0.0.1:41001",
  store: "/fixture/store",
  schema: 1,
  identity: {
    product_version: "fixture",
    build_id: "build",
    source_revision: "revision",
    track: "dev",
  },
};
const body = {
  status: "ok",
  opened_schema_version: 1,
  product_version: "fixture",
  build_id: "build",
  source_revision: "revision",
  build_track: "dev",
};
test("readiness supplements exact retained engine receipt and bounds payload without adoption", async () => {
  const engine = { pid: 7, receipt: pinned, exited: false };
  await checkReadiness(engine, pinned, async (url, options) => {
    assert.equal(url, pinned.endpoint + "/readyz");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify(body));
  });
  await assert.rejects(
    checkReadiness(engine, pinned, async () => {
      engine.receipt = { ...pinned };
      return new Response(JSON.stringify(body));
    }),
  );
  engine.receipt = pinned;
  for (const changed of [
    { ...body, opened_schema_version: 2 },
    { ...body, build_id: "other" },
  ])
    await assert.rejects(
      checkReadiness(engine, pinned, async () => new Response(JSON.stringify(changed))),
    );
  await assert.rejects(checkReadiness(engine, pinned, async () => new Response("x".repeat(16385))));
  engine.exited = true;
  await assert.rejects(
    checkReadiness(engine, pinned, async () => {
      throw Error("must not fetch");
    }),
  );
});
test("route restoration retains bounded same-origin hash only", () => {
  assert.equal(
    routeFragment(pinned.endpoint + "/#/session/fixture/files", pinned.endpoint),
    "#/session/fixture/files",
  );
  assert.equal(routeFragment("https://other.test/#/session", pinned.endpoint), "");
  assert.equal(routeFragment(pinned.endpoint + "/#" + "x".repeat(8193), pinned.endpoint), "");
});
