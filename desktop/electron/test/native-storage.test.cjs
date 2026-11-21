"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { createNativeAdapters } = require("../src/native.cjs");
function fixture() {
  const origin = "http://127.0.0.1:41001",
    incarnation = randomUUID(),
    nonce = randomUUID(),
    messages = [],
    writes = [];
  const ipcMain = new EventEmitter(),
    app = { isHidden: () => false };
  const frame = { url: origin + "/", send: (_channel, message) => messages.push(message) };
  const session = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
  });
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    getURL: () => frame.url,
    session,
    isDestroyed: () => false,
    setWindowOpenHandler() {},
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
  });
  let resolveWrite;
  const storage = {
    profile: { digest: "a".repeat(64) },
    binding: { profile: "a".repeat(64) },
    snapshot: async () => ({ available: true, values: { preferences: {}, drafts: {} } }),
    write(namespace, key, value) {
      writes.push({ namespace, key, value });
      return new Promise((resolve) => {
        resolveWrite = resolve;
      });
    },
    flush: async () => true,
  };
  const native = createNativeAdapters({
    window,
    endpoint: origin,
    incarnation,
    storage,
    electron: { ipcMain, app, shell: {}, dialog: {} },
    pickFolder() {
      throw Error("unexpected picker");
    },
  });
  const send = (kind, extra = {}, event = { sender: contents, senderFrame: frame }) => {
    if (kind === "target_settled" && !Object.hasOwn(extra, "generation")) {
      extra = { generation: messages.findLast((message) => message.kind === "session_target")?.generation, ...extra };
    }
    ipcMain.emit("nac:native", event, { version: 1, kind, nonce, incarnation, ...extra });
  };
  const ready = async (targetReady = true) => {
    send("ready");
    send("bound", { challenge: messages.at(-1).challenge });
    send("ui_ready");
    if (targetReady) send("session_target_ready", { generation: 1 });
    await Promise.resolve();
  };
  return {
    native,
    window,
    app,
    storage,
    frame,
    contents,
    messages,
    writes,
    send,
    ready,
    release: (value) => resolveWrite(value),
  };
}
test("storage reuses current document binding, exact ordered sequence and late ACK fence", async () => {
  const f = fixture();
  await f.ready();
  const document = f.messages.find((message) => message.kind === "storage_open").bootstrap.document;
  const operation = {
    version: 1,
    ...document,
    sequence: 1,
    kind: "write",
    namespace: "preferences",
    key: "nac.sidebar.open",
    value: "false",
  };
  f.send("storage", { operation: { ...operation, sequence: 2 } });
  f.send("storage", { operation: { ...operation, document: randomUUID() } });
  f.send("storage", { operation, extra: true });
  assert.equal(f.writes.length, 0);
  f.send("storage", { operation });
  f.send("storage", { operation });
  assert.equal(f.writes.length, 1);
  f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  f.release({ durable: true });
  await Promise.resolve();
  assert.equal(
    f.messages.some((message) => message.kind === "storage_ack"),
    false,
  );
  f.native.dispose();
});
test("native notification targets are one bounded guarded request; retirement consumes late answers", async () => {
  const f = fixture();
  await f.ready();
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  const message = f.messages.at(-1).targetMessage;
  assert.equal(message.source, "notification-response");
  assert.equal(message.profile, "a".repeat(64));
  assert.equal(await f.native.sessionTarget("other", "another"), "unavailable");
  f.send("target_settled", { request: message.request, outcome: "deferred" });
  assert.equal(await target, "deferred");
  const next = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  const retiring = f.native.retire();
  assert.equal(await next, "stale");
  f.send("target_settled", {
    request: f.messages.findLast((message) => message.kind === "session_target").targetMessage
      .request,
    outcome: "opened",
  });
  f.send("retired", { closed: true });
  await retiring;
  f.native.dispose();
});

test("disposed WebFrameMain accessors fail closed during queued visibility and late native callbacks", async () => {
  const f = fixture();
  await f.ready();
  Object.defineProperty(f.frame, "url", {
    get() {
      throw Error("Render frame was disposed");
    },
  });
  assert.doesNotThrow(() => f.native.setVisible(true));
  assert.doesNotThrow(() => f.send("ui_ready"));
  assert.equal(f.native.command("settings"), false);
  assert.equal(await f.native.sessionTarget("fixture", "occurrence"), "unavailable");
  f.native.dispose();
});

test("one explicit click waits for its current target owner, while a deferred result is never replayed", async () => {
  const f = fixture();
  await f.ready(false);
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  assert.equal(
    f.messages.some((message) => message.kind === "session_target"),
    false,
  );
  f.send("session_target_ready", { generation: 1 });
  const request = f.messages.at(-1).targetMessage.request;
  f.send("target_settled", { request, outcome: "deferred" });
  assert.equal(await target, "deferred");
  f.send("session_target_retired", { generation: 1 });
  f.send("session_target_ready", { generation: 1 }); // retired owner cannot return
  f.send("session_target_ready", { generation: 2 });
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
  f.native.dispose();
});

test("target initialization wait expires and retirement fences later owner readiness", async () => {
  const f = fixture();
  await f.ready(false);
  assert.equal(
    await f.native.sessionTarget("fixture-session", "fixture-occurrence"),
    "unavailable",
  );
  f.send("session_target_ready", { generation: 1 });
  assert.equal(
    f.messages.some((message) => message.kind === "session_target"),
    false,
  );
  f.send("session_target_retired", { generation: 1 });
  const pending = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  f.native.setVisible(false);
  assert.equal(await pending, "stale");
  const retiringTarget = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  const retirement = f.native.retire();
  f.send("retired", { closed: true });
  await retirement;
  // A waiting initialization has no authority after its document retires.
  assert.equal(await retiringTarget, "stale");
  f.send("session_target_ready", { generation: 2 });
  assert.equal(
    f.messages.some((message) => message.kind === "session_target"),
    false,
  );
  f.native.dispose();
});

test("one click waits for native focus and owner readiness in either order, then dispatches once", async () => {
  for (const readyFirst of [true, false]) {
    const f = fixture();
    let focused = false;
    f.window.isFocused = () => focused;
    await f.ready(readyFirst);
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
    f.window.emit("focus"); // Notification of focus is not itself a focused fact.
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
    focused = true;
    f.window.emit("focus");
    if (!readyFirst) {
      assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
      f.send("session_target_ready", { generation: 1 });
    }
    const requests = f.messages.filter((message) => message.kind === "session_target");
    assert.equal(requests.length, 1);
    f.send("target_settled", { request: requests[0].targetMessage.request, outcome: "deferred" });
    assert.equal(await target, "deferred");
    f.window.emit("focus");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    f.native.dispose();
    assert.equal(f.window.listenerCount("focus"), 0);
  }
});

test("an original hidden-app click waits for observed unhide, focus and its current owner", async () => {
  for (const focusFirst of [true, false]) {
    const f = fixture();
    let hidden = true,
      focused = false;
    f.app.isHidden = () => hidden;
    f.window.isFocused = () => focused;
    await f.ready(false);
    let outcome;
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    target.then((value) => {
      outcome = value;
    });
    f.native.setVisible(false); // Initial native unhide has not completed yet.
    f.send("session_target_ready", { generation: 1 });
    if (focusFirst) {
      focused = true;
      f.window.emit("focus");
    }
    f.native.setVisible(true); // A callback cannot replace the actual hidden-app fact.
    await Promise.resolve();
    assert.equal(outcome, undefined);
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
    hidden = false;
    f.native.setVisible(true);
    if (!focusFirst) {
      assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
      focused = true;
      f.window.emit("focus");
    }
    const messages = f.messages.filter((message) => message.kind === "session_target");
    assert.equal(messages.length, 1);
    f.send("target_settled", { request: messages[0].targetMessage.request, outcome: "deferred" });
    assert.equal(await target, "deferred");
    f.window.emit("focus");
    f.native.setVisible(true);
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    f.native.dispose();
  }
});

test("unhide readiness shares the original deadline and cannot revive after timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let hidden = true;
  f.app.isHidden = () => hidden;
  await f.ready();
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  context.mock.timers.tick(3000);
  assert.equal(await target, "unavailable");
  hidden = false;
  f.native.setVisible(true);
  f.window.emit("focus");
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
  f.native.dispose();
});

test("observed unhide fences a subsequent hide even before the React target owner is ready", async () => {
  const f = fixture();
  let hidden = true;
  f.app.isHidden = () => hidden;
  await f.ready(false);
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  hidden = false;
  f.native.setVisible(true);
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
  hidden = true;
  f.native.setVisible(false);
  f.send("session_target_ready", { generation: 1 });
  hidden = false;
  f.native.setVisible(true);
  f.window.emit("focus");
  const requests = f.messages.filter((message) => message.kind === "session_target");
  if (requests.length)
    f.send("target_settled", { request: requests[0].targetMessage.request, outcome: "opened" });
  assert.equal(requests.length, 0);
  assert.equal(await target, "stale");
  f.native.dispose();
});

test("retirement fences hidden-app initialization and a new hide fences observed unhide", async () => {
  for (const boundary of ["retire", "navigate", "dispose", "hide-again"]) {
    const f = fixture();
    let hidden = true;
    f.app.isHidden = () => hidden;
    f.window.isFocused = () => false;
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    if (boundary === "retire") {
      const done = f.native.retire();
      f.send("retired", { closed: true });
      await done;
    }
    if (boundary === "navigate")
      f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    if (boundary === "dispose") f.native.dispose();
    if (boundary === "hide-again") {
      hidden = false;
      f.native.setVisible(true);
      hidden = true;
      f.native.setVisible(false);
    }
    assert.equal(await target, "stale");
    hidden = false;
    f.window.isFocused = () => true;
    f.native.setVisible(true);
    f.window.emit("focus");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
    f.native.dispose();
  }
});

test("focus and readiness consume one original deadline without retrying a dispatched timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let focused = false;
  f.window.isFocused = () => focused;
  await f.ready(false);
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  context.mock.timers.tick(2000);
  focused = true;
  f.window.emit("focus");
  context.mock.timers.tick(900);
  f.send("session_target_ready", { generation: 1 });
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
  context.mock.timers.tick(100);
  assert.equal(await target, "unavailable");
  f.window.emit("focus");
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
  f.native.dispose();
});

test("hide and document retirement fence a click waiting for native focus", async () => {
  for (const boundary of ["hide", "retire", "navigate", "dispose"]) {
    const f = fixture();
    let focused = false;
    f.window.isFocused = () => focused;
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    if (boundary === "hide") f.native.setVisible(false);
    if (boundary === "retire") {
      const done = f.native.retire();
      f.send("retired", { closed: true });
      await done;
    }
    if (boundary === "navigate")
      f.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    if (boundary === "dispose") f.native.dispose();
    assert.equal(await target, "stale");
    focused = true;
    f.window.emit("focus");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 0);
    f.native.dispose();
    assert.equal(f.window.listenerCount("focus"), 0);
  }
});

test("one click crosses an owner gap only after an exact no-invocation receipt", async () => {
  for (const order of ["retire-ack-ready", "ack-retire-ready", "retire-ready-ack"]) {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const first = f.messages.findLast((message) => message.kind === "session_target");
    assert.equal(first.generation, 1);
    const request = first.targetMessage.request;
    const retired = () => f.send("session_target_retired", { generation: 1 });
    const noInvocation = () => f.send("target_not_invoked", { request, generation: 1 });
    const ready = () => f.send("session_target_ready", { generation: 2 });
    if (order === "retire-ack-ready") { retired(); noInvocation(); ready(); }
    if (order === "ack-retire-ready") { noInvocation(); retired(); ready(); }
    if (order === "retire-ready-ack") { retired(); ready(); noInvocation(); }
    const deliveries = f.messages.filter((message) => message.kind === "session_target");
    assert.equal(deliveries.length, 2, order);
    assert.equal(deliveries[1].generation, 2);
    assert.deepEqual(deliveries[1].targetMessage, first.targetMessage);
    // A duplicate or late receipt for the earlier delivery cannot re-arm or
    // settle the newer generation.
    noInvocation();
    f.send("target_settled", { request, generation: 1, outcome: "opened" });
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 2);
    f.send("target_settled", { request, generation: 2, outcome: "opened" });
    assert.equal(await target, "opened");
    f.native.dispose();
  }
});

test("a possibly invoked callback, invalid receipt, or second owner gap never replays", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const mode of ["settled-stale", "no-receipt", "wrong-request", "wrong-generation", "second-gap"]) {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const request = f.messages.findLast((message) => message.kind === "session_target").targetMessage.request;
    f.send("session_target_retired", { generation: 1 });
    f.send("session_target_ready", { generation: 2 });
    if (mode === "settled-stale") {
      f.send("target_settled", { request, generation: 1, outcome: "opened" });
      assert.equal(await target, "stale");
    } else {
      if (mode !== "no-receipt")
        f.send("target_not_invoked", { request: mode === "wrong-request" ? request + 1 : request,
                                        generation: mode === "wrong-generation" ? 2 : 1 });
      if (mode === "second-gap") {
        assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 2);
        f.send("session_target_retired", { generation: 2 });
        f.send("session_target_ready", { generation: 3 });
        f.send("target_not_invoked", { request, generation: 2 });
      }
      context.mock.timers.tick(3000);
      assert.equal(await target, "unavailable");
    }
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length,
                 mode === "second-gap" ? 2 : 1);
    f.native.dispose();
  }
});

test("a later hide or document retirement cancels a pre-invocation gap", async () => {
  for (const boundary of ["hide", "retire"]) {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const request = f.messages.findLast((message) => message.kind === "session_target").targetMessage.request;
    f.send("session_target_retired", { generation: 1 });
    f.send("target_not_invoked", { request, generation: 1 });
    if (boundary === "hide") f.native.setVisible(false);
    else {
      const done = f.native.retire();
      f.send("retired", { closed: true });
      await done;
    }
    assert.equal(await target, "stale");
    f.send("session_target_ready", { generation: 2 });
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    f.native.dispose();
  }
});

test("late no-invocation receipt cannot revive an expired original click", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  await f.ready();
  const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
  const request = f.messages.findLast((message) => message.kind === "session_target").targetMessage.request;
  f.send("session_target_retired", { generation: 1 });
  context.mock.timers.tick(3000);
  assert.equal(await target, "unavailable");
  f.send("target_not_invoked", { request, generation: 1 });
  f.send("session_target_ready", { generation: 2 });
  assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
  f.native.dispose();
});


test("a proven owner gap waits for both replacement UI and target owner", async () => {
  for (const uiFirst of [true, false]) {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const first = f.messages.findLast((message) => message.kind === "session_target");
    const request = first.targetMessage.request;
    f.send("ui_retired");
    f.send("session_target_retired", { generation: 1 });
    f.send("target_not_invoked", { request, generation: 1 });
    if (uiFirst) f.send("ui_ready");
    else f.send("session_target_ready", { generation: 2 });
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    if (uiFirst) f.send("session_target_ready", { generation: 2 });
    else f.send("ui_ready");
    const sent = f.messages.filter((message) => message.kind === "session_target");
    assert.equal(sent.length, 2);
    assert.equal(sent[1].generation, 2);
    assert.deepEqual(sent[1].targetMessage, first.targetMessage);
    f.send("target_settled", { request, generation: 2, outcome: "opened" });
    assert.equal(await target, "opened");
    f.native.dispose();
  }
});

test("remount wait honors the original deadline and never bypasses an intervening command", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const request = f.messages.findLast((message) => message.kind === "session_target").targetMessage.request;
    f.send("ui_retired");
    f.send("session_target_retired", { generation: 1 });
    f.send("target_not_invoked", { request, generation: 1 });
    context.mock.timers.tick(3000);
    assert.equal(await target, "unavailable");
    f.send("session_target_ready", { generation: 2 });
    f.send("ui_ready");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    f.native.dispose();
  }
  {
    const f = fixture();
    await f.ready();
    const target = f.native.sessionTarget("fixture-session", "fixture-occurrence");
    const request = f.messages.findLast((message) => message.kind === "session_target").targetMessage.request;
    f.send("target_not_invoked", { request, generation: 1 });
    assert.equal(f.native.command("settings"), true);
    f.send("session_target_ready", { generation: 2 });
    assert.equal(await target, "unavailable");
    assert.equal(f.messages.filter((message) => message.kind === "session_target").length, 1);
    f.native.dispose();
  }
});
