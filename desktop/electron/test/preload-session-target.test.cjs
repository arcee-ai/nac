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
  const target = async () => {
    receive("session_target", { targetMessage: { request: ++request } });
    await new Promise(setImmediate);
    return sent.filter((message) => message.kind === "target_settled").at(-1)?.outcome;
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
  assert.equal(await f.target(), "unavailable");
  assert.equal(calls, 2);
  f.port.connectSessionTarget(async () => {
    calls++;
    return "opened";
  });
  f.receive("retire");
  await f.target();
  assert.equal(calls, 2);
});
