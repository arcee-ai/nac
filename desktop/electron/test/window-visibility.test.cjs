"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installWindowVisibility } = require("../src/window-visibility.cjs");
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const window = new EventEmitter(),
    app = new EventEmitter();
  let hidden = false,
    minimized = false,
    visible = true,
    destroyed = false,
    current = true,
    cancelled = 0;
  window.isVisible = () => visible;
  window.isMinimized = () => minimized;
  app.isHidden = () => hidden;
  window.isDestroyed = () => destroyed;
  const facts = [];
  const dispose = installWindowVisibility({
    window,
    app,
    native: {
      setVisible(value) {
        facts.push(value);
      },
      cancelPending() {
        cancelled++;
      },
    },
    isCurrent: () => current,
  });
  return {
    window,
    app,
    facts,
    dispose: dispose.dispose,
    setHidden: (value) => {
      hidden = value;
    },
    setMinimized: (value) => {
      minimized = value;
    },
    setVisible: (value) => {
      visible = value;
    },
    retire: () => {
      current = false;
    },
    destroy: () => {
      destroyed = true;
    },
    cancelled: () => cancelled,
  };
}
test("late hide while the retained window is visible publishes true", async () => {
  const f = fixture();
  f.window.emit("hide");
  assert.equal(f.cancelled(), 1, "hide must cancel the native picker immediately");
  assert.deepEqual(f.facts, []);
  await flush();
  assert.deepEqual(f.facts, [true]);
  f.dispose();
});
test("genuine hide and reopen publish actual false and true", async () => {
  const f = fixture();
  f.setVisible(false);
  f.window.emit("hide");
  await flush();
  assert.deepEqual(f.facts, [false]);
  f.setVisible(true);
  f.window.emit("show");
  await flush();
  assert.deepEqual(f.facts, [false, true]);
  f.dispose();
});
test("native callback batches coalesce and a late show cannot reveal a hidden window", async () => {
  const f = fixture();
  f.setVisible(false);
  f.window.emit("hide");
  f.setVisible(true);
  f.window.emit("show");
  f.window.emit("hide");
  await flush();
  assert.deepEqual(f.facts, [true]);
  f.setVisible(false);
  f.window.emit("show");
  await flush();
  assert.deepEqual(f.facts, [true, false]);
  f.dispose();
});
test("retired, replaced and destroyed window callbacks cannot publish or affect a successor", async () => {
  for (const retire of [(f) => f.retire(), (f) => f.destroy(), (f) => f.dispose()]) {
    const f = fixture();
    f.window.emit("hide");
    retire(f);
    await flush();
    f.window.emit("show");
    await flush();
    assert.deepEqual(f.facts, []);
    assert.equal(f.cancelled(), 1);
    f.dispose();
  }
});

test("app hiding and minimization remain hidden even when the window visible flag stays true", async () => {
  const f = fixture();
  f.setHidden(true);
  f.app.emit("did-resign-active");
  await flush();
  assert.deepEqual(f.facts, [false]);
  f.setHidden(false);
  f.app.emit("activate");
  await flush();
  assert.deepEqual(f.facts, [false, true]);
  f.setMinimized(true);
  f.window.emit("minimize");
  await flush();
  assert.deepEqual(f.facts, [false, true, false]);
  f.setMinimized(false);
  f.window.emit("restore");
  await flush();
  assert.deepEqual(f.facts, [false, true, false, true]);
  f.dispose();
});
