"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { AttentionCoordinator } = require("../src/attention-coordinator.cjs");
const {
  defaults,
  clone,
  destination,
  decisionHash,
} = require("../src/notification-state.cjs");
const engine = "10000000-0000-0000-0000-000000000001";
const store = "30000000-0000-0000-0000-000000000001";
const binding = () => ({
  profile: "a".repeat(64),
  engine,
  endpoint: "http://127.0.0.1:12345",
});
const baseline = (cursor = 0) => ({
  store_id: store,
  cursor,
  high_water: cursor,
  baseline: true,
  more: false,
  items: [],
});
const page = (cursor = 1) => ({
  ...baseline(cursor),
  baseline: false,
  items: [
    {
      sequence: cursor,
      session_id: "chat",
      run_id: "run",
      behavior: "direct",
      kind: "request",
      goal_id: null,
      mark_version: null,
    },
  ],
});
const enabled = () => ({
  ...defaults(),
  enabled: true,
  cutoff: `${store}:0`,
  frontier: `${store}:0`,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((value) => {
    resolve = value;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(state = defaults()) {
  const f = {
    state: clone(state),
    revision: 0,
    writes: [],
    begins: [],
    retired: [],
    adds: [],
    withdrawn: [],
    navigated: [],
    binding: binding(),
    permission: { allowed: true, mayRequest: false, status: "allowed" },
  };
  const storage = {
    beginNotifications(generation) {
      const token = { generation, active: true };
      f.begins.push(token);
      return token;
    },
    async readNotifications(token) {
      return token.active
        ? {
            status: "available",
            revision: f.revision,
            state: clone(f.state),
            restored: true,
          }
        : { status: "stale" };
    },
    updateNotifications(token, revision, next) {
      const value = { token, revision, next: clone(next) };
      f.writes.push(value);
      const write = () => {
        if (revision !== f.revision)
          return { status: "stale", revision: f.revision };
        f.state = next === null ? defaults() : clone(next);
        ++f.revision;
        return { status: "durable", revision: f.revision };
      };
      return f.write ? f.write(value, write) : Promise.resolve(write());
    },
    retireNotifications(token) {
      token.active = false;
      f.retired.push(token);
      return f.drain?.promise ?? Promise.resolve({ status: "durable" });
    },
    flushNotifications() {
      return Promise.resolve({ status: "durable", revision: f.revision });
    },
  };
  const delivery = {
    response: null,
    shouldPresent: null,
    async settings() {
      return f.permission;
    },
    async authorize() {
      ++f.prompts;
      f.permission = { allowed: true, mayRequest: false, status: "allowed" };
    },
    async add(target, title) {
      f.adds.push({ target, title });
      return f.add ? f.add(target) : true;
    },
    async present() {
      return f.present ?? false;
    },
    withdraw(ids) {
      f.withdrawn.push(...ids);
    },
    withdrawProfile(profile) {
      f.withdrawn.push(profile);
    },
    retire() {
      f.deliveryRetired = true;
    },
  };
  f.prompts = 0;
  f.coordinator = new AttentionCoordinator({
    storage,
    delivery,
    getBinding: () => f.binding,
    navigate: async (target) => {
      f.navigated.push(target);
      return f.navigationResult ?? "opened";
    },
    observerFactory(options) {
      f.sinks = options;
      const observer = {
        generation: 0,
        active: false,
        start(value, cursor) {
          ++this.generation;
          this.active = true;
          f.started = { value, cursor };
        },
        stop() {
          ++this.generation;
          this.active = false;
        },
        isCurrent() {
          return f.noticeCurrent !== false;
        },
        async retire() {
          this.stop();
        },
      };
      f.observer = observer;
      return observer;
    },
  });
  f.context = () => ({
    binding: clone(f.binding),
    generation: f.observer.generation,
  });
  f.page = (value) => f.sinks.page(value, f.context());
  f.notice = (value) => f.sinks.notice(value, f.context());
  f.load = () => f.coordinator.load();
  return f;
}

test("absent opaque notification payload loads off; explicit enable alone captures new frontier", async () => {
  const f = fixture(null);
  assert.equal(await f.load(), true);
  assert.equal(f.coordinator.snapshot().enabled, false);
  assert.equal(f.observer.active, false);
  await f.coordinator.setEnabled(true);
  await f.page(baseline(42));
  assert.equal(f.state.cutoff, `${store}:42`);
  assert.equal(f.adds.length, 0);
  await f.coordinator.retire();
});

test("opt-out supersedes a late admitted enable baseline even when old local state was already off", async () => {
  const f = fixture();
  await f.load();
  await f.coordinator.setEnabled(true);
  const gate = deferred(),
    drain = deferred();
  f.drain = drain;
  f.write = (value, write) => {
    f.write = null;
    return gate.promise.then(write);
  };
  const accepting = f.page(baseline());
  await tick();
  const off = f.coordinator.setEnabled(false);
  gate.resolve();
  assert.equal(await accepting, false);
  drain.resolve({ status: "durable" });
  assert.equal(await off, true);
  assert.equal(f.state.enabled, false);
  await f.coordinator.retire();
});

test("capacity exhaustion suspends truthfully without a notification or frontier advance", async () => {
  const state = enabled();
  state.unreadCompletions = Number.MAX_SAFE_INTEGER;
  const f = fixture(state);
  await f.load();
  assert.equal(await f.page(page()), false);
  assert.equal(f.adds.length, 0);
  assert.equal(f.state.frontier, `${store}:0`);
  assert.equal(f.coordinator.snapshot().suspended, true);
  await f.coordinator.retire();
});

test("default off has no observer; enabling baseline exact ACK precedes OS permission request", async () => {
  const f = fixture();
  await f.load();
  assert.equal(f.observer.active, false);
  assert.equal(f.coordinator.snapshot().enabled, false);
  f.permission = { allowed: false, mayRequest: true, status: "pending" };
  await f.coordinator.setEnabled(true);
  assert.equal(f.started.cursor, null);
  assert.equal(f.prompts, 0);
  const gate = deferred();
  f.write = (value, write) => gate.promise.then(write);
  const accepting = f.page(baseline());
  await tick();
  assert.equal(f.prompts, 0);
  assert.equal(f.adds.length, 0);
  assert.equal(f.state.enabled, false);
  gate.resolve();
  assert.equal(await accepting, true);
  assert.equal(f.prompts, 1);
  assert.equal(f.state.enabled, true);
  await f.coordinator.retire();
});

test("reservation exact durable ACK gates delivery; duplicate and cold restart never reissue", async () => {
  const f = fixture(enabled());
  await f.load();
  const gate = deferred();
  f.write = (value, write) => {
    f.write = null;
    return gate.promise.then(write);
  };
  const accepting = f.page(page());
  await tick();
  assert.equal(f.adds.length, 0);
  assert.equal(f.writes[0].next.receipts[0].phase, "reserved");
  gate.resolve();
  assert.equal(await accepting, true);
  assert.equal(f.adds.length, 1);
  assert.equal(f.state.frontier, `${store}:1`);
  assert.equal(f.state.unreadCompletions, 1);
  assert.equal(await f.page(page()), true);
  assert.equal(f.adds.length, 1);
  await f.coordinator.retire();
  const reopened = fixture(f.state);
  await reopened.load();
  await reopened.page(page());
  assert.equal(reopened.adds.length, 0);
  assert.equal(reopened.state.unreadCompletions, 1);
  await reopened.coordinator.retire();
});

test("reserved/scheduled crash receipts reconcile without reissue or double unread", async () => {
  for (const phase of ["reserved", "scheduled"]) {
    const state = enabled();
    state.unreadCompletions = 1;
    state.receipts.push({
      occurrence: `${store}:1`,
      session: "chat",
      cursor: `${store}:1`,
      phase,
    });
    const f = fixture(state);
    await f.load();
    assert.equal(await f.page(page()), true);
    assert.equal(f.adds.length, 0);
    assert.equal(f.state.unreadCompletions, 1);
    assert.equal(f.state.deliveryUncertain, true);
    assert.equal(f.state.receipts.length, 0);
    await f.coordinator.retire();
  }
});

test("denied, pending, focus and mute consume durable frontier without deferred banner", async () => {
  for (const policy of ["denied", "pending", "focus", "mute"]) {
    const state = enabled();
    state.muted = policy === "mute";
    const f = fixture(state);
    if (["denied", "pending"].includes(policy))
      f.permission = {
        allowed: false,
        mayRequest: policy === "pending",
        status: policy,
      };
    await f.load();
    if (policy === "focus") f.coordinator.presentation(true);
    assert.equal(await f.page(page()), true);
    assert.equal(f.adds.length, 0);
    assert.equal(f.prompts, 0);
    assert.equal(f.state.unreadCompletions, 1);
    assert.equal(f.state.frontier, `${store}:1`);
    f.coordinator.presentation(false);
    f.permission = { allowed: true, mayRequest: false, status: "allowed" };
    await f.page(page());
    assert.equal(f.adds.length, 0);
    await f.coordinator.retire();
  }
});

test("wrong ACK, rejected save, storage exception and late flush never establish saved or delivered", async () => {
  for (const mode of ["wrong", "unavailable", "reject"]) {
    const f = fixture(enabled());
    await f.load();
    f.write = () =>
      mode === "reject"
        ? Promise.reject(Error("disk"))
        : Promise.resolve({
            status: mode === "wrong" ? "durable" : "unavailable",
            revision: 99,
          });
    assert.equal(await f.page(page()), false);
    assert.equal(f.adds.length, 0);
    assert.equal(f.coordinator.snapshot().suspended, true);
    assert.match(
      f.coordinator.snapshot().message,
      /previous saved setting may return/,
    );
    await f.coordinator.retire();
  }
});

test("opt-out and reset fence synchronously while an old save is pending; late ACK cannot show", async () => {
  for (const action of ["off", "reset"]) {
    const f = fixture(enabled());
    await f.load();
    const gate = deferred(),
      drain = deferred();
    f.drain = drain;
    f.write = (value, write) => {
      f.write = null;
      return gate.promise.then(write);
    };
    const accepting = f.page(page());
    await tick();
    const mutation =
      action === "off"
        ? f.coordinator.setEnabled(false)
        : f.coordinator.reset();
    assert.equal(f.coordinator.snapshot().enabled, false);
    assert.equal(f.observer.active, false);
    assert.equal(f.begins[0].active, false);
    gate.resolve();
    assert.equal(await accepting, false);
    drain.resolve({ status: "durable" });
    assert.equal(await mutation, true);
    assert.equal(f.adds.length, 0);
    assert.equal(f.state.enabled, false);
    await f.coordinator.retire();
  }
});

test("focus/mute/reset during native callback withdraw; current click carries session only and consumes deferred target", async () => {
  const f = fixture(enabled());
  await f.load();
  const gate = deferred();
  f.add = () => gate.promise;
  const accepting = f.page(page());
  await tick();
  assert.equal(f.adds.length, 1);
  f.coordinator.presentation(true);
  gate.resolve(true);
  await accepting;
  assert.equal(await f.coordinator.respond(f.adds[0].target), false);
  assert.equal(f.navigated.length, 0);
  f.coordinator.presentation(false);
  f.add = null;
  await f.page(page(2));
  const target = f.adds.at(-1).target;
  f.navigationResult = "deferred";
  assert.equal(await f.coordinator.respond(target), false);
  assert.deepEqual(f.navigated, [{ session: "chat" }]);
  f.coordinator.navigationReady();
  assert.equal(f.navigated.length, 1);
  assert.equal(await f.coordinator.respond(target), false);
  await f.coordinator.retire();
});

test("decision dedup/resolution and current check after reservation; stale profile/engine callbacks refuse", async () => {
  const notice = {
    session: "chat",
    identity: "p7:request",
    sourceEpoch: engine,
    decision: { kind: "permission", request_id: "request" },
  };
  const f = fixture(enabled());
  await f.load();
  const gate = deferred();
  f.write = (value, write) => {
    f.write = null;
    return gate.promise.then(write);
  };
  const accepting = f.notice(notice);
  await tick();
  f.noticeCurrent = false;
  gate.resolve();
  assert.equal(await accepting, true);
  assert.equal(f.adds.length, 0);
  f.noticeCurrent = true;
  await f.notice(notice);
  assert.equal(f.adds.length, 0);
  assert.equal(
    f.state.seenDecisions[0],
    decisionHash(f.binding.profile, "chat", notice.identity),
  );
  await f.page(page());
  const target = f.adds[0].target;
  f.binding = { ...f.binding, engine: "20000000-0000-0000-0000-000000000001" };
  assert.equal(await f.coordinator.respond(target), false);
  assert.equal(f.navigated.length, 0);
  await f.coordinator.rebind();
  assert.equal(await f.coordinator.respond(target), false);
  f.binding = { ...f.binding, profile: "b".repeat(64) };
  await f.coordinator.rebind();
  assert.equal(await f.coordinator.respond(target), false);
  await f.coordinator.retire();
});

test("late native success after reset cannot create a scheduled receipt or navigate", async () => {
  const f = fixture(enabled());
  await f.load();
  const gate = deferred();
  f.add = () => gate.promise;
  const accepting = f.page(page());
  await tick();
  const target = f.adds[0].target;
  assert.equal(await f.coordinator.reset(), true);
  gate.resolve(true);
  assert.equal(await accepting, false);
  assert.deepEqual(f.state, defaults());
  assert.equal(await f.coordinator.respond(target), false);
  await f.coordinator.retire();
});

test("unavailable read/invalid Swift state fail closed and bounded store mismatch cannot replay history", async () => {
  const f = fixture({ ...enabled(), frontier: null });
  assert.equal(await f.load(), false);
  assert.equal(f.observer.active, false);
  await f.coordinator.retire();
  const current = fixture(enabled());
  await current.load();
  assert.equal(await current.page({ ...page(), store_id: engine }), false);
  assert.equal(current.adds.length, 0);
  await current.coordinator.retire();
});
