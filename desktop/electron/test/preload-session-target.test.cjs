"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function fixture(tagName = "TEXTAREA", retained = true, contentEditable = false) {
  const sent = [],
    page = {},
    events = new EventEmitter(),
    ipcRenderer = new EventEmitter();
  const nonce = "cda22db6-8d8a-4d1b-9ea4-c3f466f8a0ed",
    incarnation = "2280d0fe-d2e0-4287-a139-c0b1fa93d102";
  class Element {
    constructor() {
      this.tagName = tagName;
      this.isContentEditable = contentEditable;
    }
    hasAttribute(name) {
      return retained && name === "data-nac-retained-draft";
    }
  }
  const document = {
    activeElement: new Element(),
    readyState: "complete",
    addEventListener: (name, callback) => events.on(name, callback),
    hasFocus: () => true,
  };
  ipcRenderer.send = (_channel, value) => sent.push(value);
  const contextBridge = {
    exposeInMainWorld: (name, value) => {
      page[name] = value;
    },
    executeInMainWorld() {}, // Directory picker wrapper is outside this boundary.
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/preload.cjs"), "utf8"), {
    require(name) {
      assert.equal(name, "electron");
      return { contextBridge, ipcRenderer };
    },
    process: {
      isMainFrame: true,
      argv: ["--nac-origin=http://127.0.0.1:41001", "--nac-incarnation=" + incarnation],
    },
    location: { origin: "http://127.0.0.1:41001" },
    crypto: { randomUUID: () => nonce },
    document,
    window: { addEventListener() {} },
    HTMLElement: Element,
    HTMLAnchorElement: class {},
    URL,
    TextEncoder,
  });
  const receive = (kind, extra = {}) =>
    ipcRenderer.emit("nac:document", {}, { version: 1, nonce, incarnation, kind, ...extra });
  receive("activate", { visible: true });
  let request = 0;
  const target = async (generation = 1) => {
    const before = sent.length;
    receive("session_target", { generation, targetMessage: { request: ++request } });
    await new Promise(setImmediate);
    const receipt = sent.slice(before).find((message) =>
      message.kind === "target_settled" || message.kind === "target_not_invoked");
    return receipt?.kind === "target_not_invoked" ? "not_invoked" : receipt?.outcome;
  };
  return { port: page.__nacDesktop, events, receive, target, sent };
}

test("session targets reach the shared guard with retained editors and defer unretained editors", async () => {
  for (const [tag, editable] of [
    ["INPUT", false],
    ["TEXTAREA", false],
    ["SELECT", false],
    ["DIV", true],
  ]) {
    for (const retained of [true, false]) {
      const f = fixture(tag, retained, editable);
      let calls = 0;
      f.port.connectSessionTarget(async () => {
        calls++;
        return "opened";
      });
      assert.equal(
        await f.target(),
        retained ? "opened" : "deferred",
        `${tag} retained=${retained}`,
      );
      assert.equal(calls, retained ? 1 : 0);
    }
  }
});

test("retained draft does not bypass IME, shared modal deferral, owner or document retirement", async () => {
  const f = fixture();
  let calls = 0,
    sharedOutcome = "deferred";
  const disconnect = f.port.connectSessionTarget(async () => {
    calls++;
    return sharedOutcome;
  });
  f.events.emit("compositionstart");
  assert.equal(await f.target(), "deferred");
  assert.equal(calls, 0);
  f.events.emit("compositionend");
  await new Promise(setImmediate);
  assert.equal(calls, 0); // No delayed navigation.
  assert.equal(await f.target(), "deferred");
  assert.equal(calls, 1); // Shared modal/editor owner decides.
  sharedOutcome = "opened";
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(await f.target(), "opened");
  assert.equal(calls, 2);
  disconnect();
  assert.equal(await f.target(), "not_invoked");
  assert.equal(calls, 2);
  f.port.connectSessionTarget(async () => {
    calls++;
    return "opened";
  });
  f.receive("retire");
  await f.target();
  assert.equal(calls, 2);
});

test("missing or replaced owner proves non-invocation; an invoked request cannot be rearmed", async () => {
  const f = fixture();
  f.receive("session_target", { generation: 1, targetMessage: { request: 1 } });
  assert.equal(f.sent.at(-1).kind, "target_not_invoked");
  assert.equal(f.sent.at(-1).generation, 1);
  let calls = 0;
  const close = f.port.connectSessionTarget(async () => { calls++; return "opened"; });
  f.receive("session_target", { generation: 1, targetMessage: { request: 1 } });
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  close();
  f.port.connectSessionTarget(async () => { calls++; return "opened"; });
  f.receive("session_target", { generation: 2, targetMessage: { request: 1 } });
  assert.equal(f.sent.at(-1).kind, "target_settled");
  assert.equal(f.sent.at(-1).outcome, "stale");
  await new Promise(setImmediate);
  assert.equal(calls, 1);
});

test("composition and unretained editors are final deferrals even with no owner", async () => {
  const f = fixture("INPUT", false);
  f.receive("session_target", { generation: 1, targetMessage: { request: 1 } });
  assert.equal(f.sent.at(-1).kind, "target_settled");
  assert.equal(f.sent.at(-1).outcome, "deferred");
  const composing = fixture();
  composing.events.emit("compositionstart");
  composing.receive("session_target", { generation: 1, targetMessage: { request: 1 } });
  assert.equal(composing.sent.at(-1).kind, "target_settled");
  assert.equal(composing.sent.at(-1).outcome, "deferred");
});


test("retirement before the callback microtask cannot invoke or rearm a consumed request", async () => {
  const f = fixture();
  let calls = 0;
  const disconnect = f.port.connectSessionTarget(async () => { calls++; return "opened"; });
  f.receive("session_target", { generation: 1, targetMessage: { request: 1 } });
  disconnect();
  f.port.connectSessionTarget(async () => { calls++; return "opened"; });
  await new Promise(setImmediate);
  assert.equal(calls, 0);
  // A retired connection's consumed callback produces no acknowledgement;
  // the main flight remains bounded by its original timeout.
  assert.equal(f.sent.some((message) => message.kind === "target_settled"), false);
  f.receive("session_target", { generation: 2, targetMessage: { request: 1 } });
  assert.equal(f.sent.at(-1).kind, "target_settled");
  assert.equal(f.sent.at(-1).outcome, "stale");
  assert.equal(f.sent.some((message) => message.kind === "target_not_invoked"), false);
  await new Promise(setImmediate);
  assert.equal(calls, 0);
});
