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
  const window = {
    webContents: contents,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
  };
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
  const send = (kind, extra = {}, event = { sender: contents, senderFrame: frame }) =>
    ipcMain.emit("nac:native", event, { version: 1, kind, nonce, incarnation, ...extra });
  const ready = async () => {
    send("ready");
    send("bound", { challenge: messages.at(-1).challenge });
    send("ui_ready");
    await Promise.resolve();
  };
  return {
    native,
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
