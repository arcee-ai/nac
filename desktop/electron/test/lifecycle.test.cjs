"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Lifecycle } = require("../src/lifecycle.cjs");
test("Cancel leaves launch and hide intact; duplicate Quit owns one choice", () => {
  const l = new Lifecycle(),
    launch = l.beginLaunch(),
    q = l.requestQuit();
  assert.equal(l.requestQuit().kind, "pending");
  assert.equal(l.canHide, false);
  assert.equal(l.answer(q.transaction, false).kind, "cancel");
  assert.equal(l.launch, launch);
  assert.equal(l.canHide, true);
  assert.equal(l.answer(q.transaction, true).kind, "ignored");
});
test("Stop is one transaction, no retry; late child and choice callbacks fenced", () => {
  const l = new Lifecycle(),
    launch = l.beginLaunch(),
    q = l.requestQuit(),
    s = l.answer(q.transaction, true);
  assert.equal(l.beginLaunch(), null);
  assert.equal(l.requestQuit().token, s.token);
  l.childExited("wrong");
  assert.equal(l.launch, launch);
  assert.equal(l.stopped(s.token, false), "ignored");
  l.childExited(launch);
  assert.equal(l.stopped(s.token, true), "terminate");
  assert.equal(l.requestQuit().kind, "terminate");
});
test("UI timeout never proves settlement; repeated Quit retains original stop", () => {
  const l = new Lifecycle();
  l.beginLaunch();
  const q = l.requestQuit(),
    s = l.answer(q.transaction, true);
  assert.equal(l.timedOut(s.token), true);
  assert.equal(l.phase, "pending-cleanup");
  const wait = l.requestQuit();
  assert.equal(wait.token, s.token);
  assert.equal(l.timedOut(s.token), true);
  assert.equal(l.stopped(s.token, true), "settled-after-timeout");
});
